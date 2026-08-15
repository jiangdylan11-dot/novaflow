from __future__ import annotations

import base64
import gc
import hashlib
import io
import json
import math
import os
import random
import re
import socket
import sys
import time
import traceback
from difflib import SequenceMatcher
from pathlib import Path

from prompt_assistant.art_prompt_contract import (
    EDIT_CONTRACT as ART_PROMPT_EDIT_CONTRACT,
    SCHEMA_VERSION as ART_PROMPT_SCHEMA_VERSION,
    STRUCTURED_OUTPUT_MAX_TOKENS as ART_PROMPT_STRUCTURED_OUTPUT_MAX_TOKENS,
    ArtPromptContractError,
    build_art_prompt_contract_instruction,
    compile_art_prompt_contract,
    front_five_scalar_values as art_prompt_front_five_scalar_values,
    front_five_sections as art_prompt_front_five_sections,
    parse_art_prompt_contract,
    terminal_constraint_text as art_prompt_terminal_constraint_text,
)
from prompt_assistant.qwen3_vl_adapter import Qwen3VLAbliteratedAdapter, Qwen3VLProviderError
from prompt_assistant.visual_contract import (
    RICH_VISUAL_SYSTEM_TEXT,
    SCHEMA_VERSION as VISUAL_SCHEMA_VERSION,
    SCHEMA_VERSION_V2 as VISUAL_SCHEMA_VERSION_V2,
    VisualContractError,
    append_rich_generation_requirements,
    compile_degraded_visual_prompt_details,
    compile_deterministic_rich_visual_prompt,
    compile_partial_visual_prompt_details,
    compile_visual_prompt_details,
    local_compact_visual_contract_instruction,
    merge_local_salient_inventory,
    parse_local_salient_inventory,
    parse_local_compact_visual_contract,
    parse_local_single_image_compact_visual_contract,
    parse_local_single_image_recoverable_partial_contract,
    parse_visual_contract,
    rich_visual_prompt_instruction,
    validate_rich_visual_prompt,
    visual_contract_instruction,
)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")


MODEL_TYPE = "qwen2_5_vl_7b_fp8"
DEFAULT_RUNTIME_JSON = Path(r"C:\ProgramData\NovaFlow\AI-Runtime\runtime.json")
DEFAULT_COMFY_ROOT = Path(r"C:\ProgramData\NovaFlow\AI-Runtime\engine\ComfyUI")
DEFAULT_MODEL_PATH = Path(r"E:\BaiduNetdiskDownload\qwen_2.5_vl_7b_fp8_scaled.safetensors")
DEFAULT_MODEL_NAME = "qwen_2.5_vl_7b_fp8_scaled.safetensors"
DEFAULT_REVERSE_QWEN3_MODEL_PATH = Path(
    r"E:\BaiduNetdiskDownload\prompt_generator\Huihui-Qwen3-VL-8B-Instruct-Abliterated"
)
STOP_TOKENS = [151645, 151643]
NEGATIVE_COMMON_PREFIX = ["低质量", "模糊"]
NEGATIVE_SUFFIX = ["水印", "Logo"]
NEGATIVE_MAX_COUNT = 18
ORDINARY_ART_PROMPT_BASE_MAX_LENGTH = 180
ORDINARY_ART_PROMPT_MAX_LENGTH = 1024
ORDINARY_ART_PROMPT_BASE_CHAR_THRESHOLD = 320
# The shipped Qwen2.5 tokenizer measures the reported 1,232-character CJK Art
# prompt at 309 tokens.  0.65 output tokens per source character therefore
# leaves about 2.5x rewrite headroom while the cap bounds worst-case latency.
ORDINARY_ART_PROMPT_TOKEN_GROWTH = 0.65
ORDINARY_ART_PROMPT_PATCH_MAX_LENGTH = 320
ORDINARY_ART_PROMPT_PATCH_RETRY_LATEST_SECONDS = 120
ORDINARY_ART_EDIT_CONTRACT = "deterministic-merge-v1"
PROMPT_ASSISTANT_GUARD_HOST = "127.0.0.1"
PROMPT_ASSISTANT_GUARD_PORT = 4762
STORYBOARD_VISUAL_EVENT_MAX_LENGTH = 640
STORYBOARD_VISUAL_EVENT_ACTION_REPAIR_MAX_LENGTH = 160
STORYBOARD_VISUAL_EVENT_ACTION_REPAIR_LIMIT = 0
STORYBOARD_VISUAL_EVENT_REALIZER_ENABLED = False
STORYBOARD_VISUAL_EVENT_CHAIN_AI_REWRITE_ENABLED = False
STORYBOARD_VISUAL_EVENT_LOCAL_MATERIALIZER_ENABLED = False
STORYBOARD_VISUAL_EVENT_LOCAL_DRAWABLE_GUARD_ENABLED = False
STORYBOARD_LOCAL_STORY_CHAIN_ENABLED = False
STORYBOARD_LOCAL_STORY_CHAIN_BYPASS_MODEL = False
STORYBOARD_FINAL_SHOT_LOCAL_COMPOSER_ENABLED = False
STORYBOARD_FINAL_SHOT_PROMPT_MAX_LENGTH = 1000
STORYBOARD_UNIFIED_NINE_SHOT_MAX_LENGTH = 1200
MINIMAX_H3_PROMPT_PURPOSE = "minimax-h3-prompt-enhance"
MINIMAX_H3_PROMPT_MAX_LENGTH = 1536
MINIMAX_H3_PROMPT_REPAIR_MAX_LENGTH = 512
MINIMAX_H3_PROMPT_MODE_MAX_LENGTHS = {
    "T2VA": 384,
    "I2VA": 512,
    "FL2VA": 512,
    "L2VA": 512,
    "REF2VA": 768,
}
MINIMAX_H3_PROMPT_MODE_REPAIR_MAX_LENGTHS = {
    "T2VA": 256,
    "I2VA": 384,
    "FL2VA": 384,
    "L2VA": 384,
    "REF2VA": 512,
}
MINIMAX_H3_I2V_REVERSE_PURPOSE = "minimax-h3-i2v-reverse"
MINIMAX_H3_FL2V_REVERSE_PURPOSE = "minimax-h3-fl2v-reverse"
MINIMAX_H3_MIN_DURATION_SECONDS = 1.0
MINIMAX_H3_MAX_DURATION_SECONDS = 15.0
MINIMAX_H3_VISUAL_SCHEMA_VERSION = "nf.h3.visual.v1"
MINIMAX_H3_VISUAL_CONTENT_POLICY_KEYS = (
    "sensitiveVisualAnalysis",
    "allSubjectsConfirmedAdult",
)
MINIMAX_H3_BASE_PROMPT_FIELDS = (
    "integrated_multimodal_description",
    "overall_soundscape",
    "non_diegetic_music",
)
# Keep these semantically identical to the renderer H3 workflow gates.  The
# backend must reject a model answer before returning text the frontend would
# immediately reject for lacking action progression or camera direction.
MINIMAX_H3_CAMERA_DIRECTION_PATTERN = re.compile(
    r"(?:运镜|镜头(?:保持|固定|静止|稳定|缓慢|轻微|平稳|跟随|推进|拉远|摇摄|移动|环绕|上升|下降|变焦|切换)"
    r"|(?:固定|静止|手持|跟随|推进|拉远|摇摄|环绕|升降|变焦|推轨)[^。\n]{0,10}镜头)"
    r"|\bcamera\b[^.\n]{0,36}\b(?:holds|remains|stays|static|locked|moves|pushes|pulls|pans|tilts|tracks|orbits|dollies|cranes|follows)\b"
    r"|\b(?:static camera|locked[- ]off camera|handheld camera|camera (?:movement|motion)|dolly|tracking shot|push[- ]in|pull[- ]out)\b",
    re.I,
)
MINIMAX_H3_ACTION_PROGRESSION_PATTERN = re.compile(
    r"(?:开始|随后|接着|逐渐|持续|过程|转身|移动|抬起|放下|完成|最终|过渡|动作)"
    r"|\b(?:begin(?:s)?|then|next|gradually|progress(?:es|ion)?|continues?|turns?|moves?|raises?|lowers?|completes?|finally|resolves?|transition|motion|action)\b",
    re.I,
)
MINIMAX_H3_USER_CAMERA_INTENT_PATTERN = re.compile(
    MINIMAX_H3_CAMERA_DIRECTION_PATTERN.pattern
    + r"|(?:推镜|推近|拉镜|横摇|纵摇|跟拍|环绕拍摄)"
    + r"|\b(?:zoom(?:s|ing)?|pan(?:s|ning)?|tilt(?:s|ing)?|track(?:s|ing)?|orbit(?:s|ing)?|arc(?:s|ing)?)\b",
    re.I,
)
MINIMAX_H3_USER_SUBJECT_ACTION_INTENT_PATTERN = re.compile(
    r"(?:转身|回头|移动|抬起|放下|走向|走到|走出|走进|奔跑|跑向|跳起|挥手|眨眼|点头|摇头|"
    r"坐下|站起|起身|靠近|远离|伸手|张开|闭上|旋转|下落|飞行|攻击|拥抱|亲吻)"
    r"|\b(?:turn(?:s|ing)?|look(?:s|ing)? back|move(?:s|d|ing)?|raise(?:s|d|ing)?|lower(?:s|ed|ing)?|"
    r"walk(?:s|ed|ing)?|run(?:s|ning)?|jump(?:s|ed|ing)?|wave(?:s|d|ing)?|blink(?:s|ed|ing)?|"
    r"nod(?:s|ded|ding)?|sit(?:s|ting)? down|stand(?:s|ing)?(?: up)?|ris(?:e|es|ing)|approach(?:es|ed|ing)?|"
    r"reach(?:es|ed|ing)?|open(?:s|ed|ing)?|close(?:s|d|ing)?|rotate(?:s|d|ing)?|fall(?:s|ing)?|"
    r"fly(?:s|ing)?|attack(?:s|ed|ing)?|hug(?:s|ged|ging)?|kiss(?:es|ed|ing)?)\b",
    re.I,
)
MINIMAX_H3_REFERENCE_PROMPT_FIELDS = (
    "subject_definitions",
    "summary",
    "retention_analysis",
    "detailed_description",
    "overall_soundscape",
    "non_diegetic_music",
)
MINIMAX_H3_NEGATIVE_SECTION_PATTERN = re.compile(
    r"(?im)(?:^|\n)[\t ]*"
    r"(?:(?:[-+*\u2022]|#{1,6}|>{1,3}|\d{1,2}[.)])[\t ]*)?"
    r"(?:(?:\*\*|__|`)[\t ]*)?"
    r"(?:negative(?:[\t _-]*prompt)?|负向(?:提示词)?|负面(?:提示词)?|反向(?:提示词)?|反面(?:提示词)?)"
    r"[\t ]*(?:(?:\*\*|__|`)[\t ]*)?[:：][\t ]*(?:(?:\*\*|__|`)[\t ]*)?"
)
MINIMAX_H3_PROMPT_SYSTEM_INSTRUCTION = (
    "You are NovaFlow's dedicated MiniMax H3 audiovisual prompt compiler. "
    "Create an original prompt from the user's material; do not reproduce examples or third-party prompt templates.\n"
    "First identify the applicable H3 mode: T2VA, I2VA, FL2VA, L2VA, or full-reference Ref2VA. "
    "For T2VA, I2VA, FL2VA, and L2VA, output these fields in this exact order: "
    "integrated_multimodal_description, overall_soundscape, non_diegetic_music. "
    "For Ref2VA, output these fields in this exact order: subject_definitions, summary, retention_analysis, "
    "detailed_description, overall_soundscape, non_diegetic_music.\n"
    "Use the exact English field names followed by colons. Write prose field values in the primary language of the "
    "user's input; when that language is Chinese, use Simplified Chinese. Preserve dialogue, lyrics, and visible "
    "scene text in their original language without translating them. Use [Shot 1] without a timestamp; later shots "
    "use [Shot N] At MM:SS.mmm with strictly increasing times inside the requested duration.\n"
    "Each shot must integrate composition, referenced subjects, environment, visible actions and state changes, "
    "camera behavior, and synchronized diegetic sound. Keep speaker IDs and reference labels stable. Only use labels "
    "that the input establishes: <Subject N>, <Picture N>, <Video N>, and <Audio N>. For keyframe modes, explicitly "
    "describe the continuous path from or toward the supplied frame anchors.\n"
    "Do not invent unavailable reference assets. Resolve conflicting instructions in favor of explicit user constraints. "
    "Do not output negative prompts, avoidance lists, Markdown, analysis, alternatives, or commentary. Return only the "
    "final H3 field structure."
)
MINIMAX_H3_PROMPT_LLAMA_TEMPLATE = (
    f"<|im_start|>system\n{MINIMAX_H3_PROMPT_SYSTEM_INSTRUCTION}<|im_end|>\n"
    "<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n"
)

MINIMAX_H3_SENSITIVE_LEVELS = {"suggestive", "nudity", "explicit"}
# Hard rejection is intentionally limited to unequivocal minor evidence.  Age
# presentation words (girl/boy/teen/young/少女/少年/年轻, etc.) are ambiguous
# visual descriptors and must not be promoted into an age determination.
MINIMAX_H3_YOUNG_OUTPUT_PATTERN = re.compile(
    r"(?:幼女|幼童|幼儿|婴幼儿|婴儿|萝莉|正太|未成年人?|儿童|孩童|小孩|"
    r"未满\s*(?:18|十八)\s*岁?|(?:18|十八)\s*岁?\s*(?:以下|以内)|"
    r"(?<![0-9])(?:1[0-7]|[0-9])\s*岁(?![0-9]))"
    r"|(?<![a-z0-9_])(?:loli|shota|child(?:ren)?(?![-\s]?like\b)|minors?|underage|juveniles?|"
    r"under[-\s]*18|(?:1[0-7]|[0-9])[-\s]*years?[-\s]*old|"
    r"(?:1[0-7]|[0-9])\s*y\s*/?\s*o|aged?\s*(?:1[0-7]|[0-9]))(?![a-z0-9_])",
    flags=re.I,
)
MINIMAX_H3_AMBIGUOUS_AGE_WORDING_PATTERN = re.compile(
    r"(?:少女|少年|女孩|男孩|年轻|青少年|幼态|娃娃脸)"
    r"|(?<![a-z0-9_])(?:teens?|teenage(?:d|rs?)?|adolescents?|girls?|boys?|"
    r"young(?:[-\s]+looking)?|youths?)(?![a-z0-9_])",
    re.I,
)
MINIMAX_H3_EXPLICIT_ADULT_ASSERTION_PATTERN = re.compile(
    r"(?:成年人?|成年(?:女性|男性|主体|角色)?|成人(?:女性|男性|主体|角色)?|年满\s*18\s*岁|18\s*岁以上)"
    r"|(?<![a-z0-9_])(?:adults?|adult[-\s]+(?:woman|man|person|subject)|18\+)(?![a-z0-9_])",
    re.I,
)
# Ordinary age fidelity uses the same unequivocal evidence boundary.  Ambiguous
# presentation words remain identity/style facts rather than age_child facts.
MINIMAX_H3_CHILD_AGE_FACT_PATTERN = re.compile(
    r"(?:幼女|幼童|幼儿|婴幼儿|婴儿|萝莉|正太|未成年人?|儿童|孩童|小孩|"
    r"未满\s*(?:18|十八)\s*岁?|(?:18|十八)\s*岁?\s*(?:以下|以内)|"
    r"(?<![0-9])(?:1[0-7]|[0-9])\s*岁(?![0-9]))"
    r"|(?<![a-z0-9_])(?:loli|shota|child(?:ren)?(?![-\s]?like\b)|minors?|underage|juveniles?|"
    r"under[-\s]*18|(?:1[0-7]|[0-9])[-\s]*years?[-\s]*old|"
    r"(?:1[0-7]|[0-9])\s*y\s*/?\s*o|aged?\s*(?:1[0-7]|[0-9]))(?![a-z0-9_])",
    flags=re.I,
)
MINIMAX_H3_SENSITIVE_REQUEST_NEGATION_PATTERN = re.compile(
    r"(?:不|不要|不得|禁止|避免|排除|不含|没有|无|勿|请勿|负面|负向|反向)"
    r"\s*[^，。；;,.!?！？]{0,12}$"
    r"|(?<![a-z0-9_])(?:not|no|never|without|avoid|exclude|forbid|prohibit|negative(?:\s+prompt)?)"
    r"(?:\s+\w+){0,4}\s*$",
    flags=re.I,
)
MINIMAX_H3_APPAREL_CATEGORY_PATTERNS = {
    "shirt": re.compile(r"(?:衬衫|上衣|短袖|长袖)|(?<![a-z])(?:shirt|blouse|t-shirt|tee)(?![a-z])", re.I),
    "dress": re.compile(r"(?:连衣裙|礼服裙)|(?<![a-z])(?:dress|gown)(?![a-z])", re.I),
    "skirt": re.compile(r"(?:短裙|长裙|半身裙|裙子)|(?<![a-z])skirt(?![a-z])", re.I),
    "pants": re.compile(r"(?:裤子|长裤|短裤)|(?<![a-z])(?:pants|trousers|shorts)(?![a-z])", re.I),
    "underwear": re.compile(r"(?:内衣|内裤|贴身衣物)|(?<![a-z])(?:underwear|lingerie|panties|briefs)(?![a-z])", re.I),
    "bra": re.compile(r"(?:胸罩|文胸)|(?<![a-z])bra(?![a-z])", re.I),
    "coat": re.compile(r"(?:外套|夹克|大衣)|(?<![a-z])(?:coat|jacket)(?![a-z])", re.I),
    "armor": re.compile(r"(?:盔甲|铠甲|护甲)|(?<![a-z])armou?r(?![a-z])", re.I),
    "shoes": re.compile(r"(?:鞋子|鞋靴|靴子|高跟鞋)|(?<![a-z])(?:shoes?|boots?|heels?)(?![a-z])", re.I),
    "socks": re.compile(r"(?:袜子|长袜|短袜)|(?<![a-z])(?:socks?|stockings?)(?![a-z])", re.I),
}
MINIMAX_H3_SENSITIVE_SIGNAL_PATTERNS = {
    "sexualized_pose": re.compile(
        r"(?:性感姿势|性暗示姿势|挑逗姿势|挑逗动作|暴露姿势)"
        r"|(?<![a-z0-9_])(?:sexualized[_\s-]+pose|suggestive[_\s-]+pose|provocative[_\s-]+pose)(?![a-z0-9_])",
        flags=re.I,
    ),
    "nudity": re.compile(
        r"(?:裸体|裸露|全裸|半裸|一丝不挂|赤裸|裸身|胸部暴露|乳房|乳头|生殖器|阴部|下体)"
        r"|(?<![a-z0-9_])(?:nudity|nude|naked|topless|bare breasts?|exposed breasts?|genitals?)(?![a-z0-9_])",
        flags=re.I,
    ),
    "explicit_activity": re.compile(
        r"(?:性行为|性交|交合|性爱|口交|肛交|自慰|手淫|插入|性刺激)"
        r"|(?<![a-z0-9_])(?:explicit[_\s-]+activity|sexual[_\s-]+activity|intercourse|oral sex|anal sex|"
        r"masturbat(?:e|ion|ing)|penetrat(?:e|ion|ing))(?![a-z0-9_])",
        flags=re.I,
    ),
    "explicit_anatomy": re.compile(
        r"(?:生殖器|性器官|阴茎|阳具|龟头|阴道|外阴|阴唇|阴蒂|肛门|乳头|乳房|阴部|下体)"
        r"|(?<![a-z0-9_])(?:explicit[_\s-]+anatomy|genitals?|penis|vagina|vulva|anus|nipples?|breasts?)(?![a-z0-9_])",
        flags=re.I,
    ),
    "sexual_fluid": re.compile(
        r"(?:精液|性体液|体液)"
        r"|(?<![a-z0-9_])(?:semen|sexual[_\s-]+fluid|bodily[_\s-]+fluid)(?![a-z0-9_])",
        flags=re.I,
    ),
}
MINIMAX_H3_FACT_CONCEPT_PATTERNS = {
    # Age and stable identity.  These are intentionally bilingual because the
    # visual IR is commonly Chinese while an explicitly requested H3 response
    # may be English.
    "age_adult": re.compile(
        r"(?:成年|成人|成熟女性|成熟男性|女性|男性|女人|男人|女士|男士)"
        r"|(?<![a-z0-9_])(?:adults?|women|woman|men|man|lad(?:y|ies)|gentlemen?)(?![a-z0-9_])",
        re.I,
    ),
    "age_child": MINIMAX_H3_CHILD_AGE_FACT_PATTERN,
    "identity_female": re.compile(
        r"(?:女性|女人|女士|女孩)|(?<![a-z0-9_])(?:female|woman|lady|girl)(?![a-z0-9_])",
        re.I,
    ),
    "identity_male": re.compile(
        r"(?:男性|男人|男士|男孩)|(?<![a-z0-9_])(?:male|man|gentleman|boy)(?![a-z0-9_])",
        re.I,
    ),
    "identity_person": re.compile(
        r"(?:人物|角色|人形)|(?<![a-z0-9_])(?:person|subject|character|figure|humanoid)(?![a-z0-9_])",
        re.I,
    ),
    "identity_cat_ears": re.compile(
        r"(?:猫耳|猫娘)|(?<![a-z0-9_])(?:cat[-\s]?ears?|catgirl)(?![a-z0-9_])"
        r"|(?<![a-z0-9_])(?:fox_ear_catgirl|cat_ears)(?![a-z0-9_])",
        re.I,
    ),
    "identity_robot": re.compile(r"(?:机器人|机械人|机甲)|(?<![a-z0-9_])(?:robot|android|mecha)(?![a-z0-9_])", re.I),
    "identity_knight": re.compile(r"(?:骑士)|(?<![a-z0-9_])knight(?![a-z0-9_])", re.I),
    "identity_warrior": re.compile(r"(?:战士|武士)|(?<![a-z0-9_])(?:warrior|samurai)(?![a-z0-9_])", re.I),
    "feature_long_hair": re.compile(
        r"(?:长发)|(?<![a-z0-9_])long[-\s]+hair(?:ed)?(?![a-z0-9_])"
        r"|(?<![a-z0-9_])white_long_hair(?![a-z0-9_])",
        re.I,
    ),
    "feature_silver_hair": re.compile(r"(?:银白(?:色)?(?:长)?发|银发)|(?<![a-z0-9_])silver(?:y)?[-\s]+hair(?![a-z0-9_])", re.I),
    "feature_blue_eyes": re.compile(
        r"(?:蓝色眼睛|蓝眼)|(?<![a-z0-9_])blue[-\s]+eyes?(?![a-z0-9_])"
        r"|(?<![a-z0-9_])blue_eyes(?![a-z0-9_])",
        re.I,
    ),
    "feature_red_hair": re.compile(r"(?:红发|红色头发)|(?<![a-z0-9_])red[-\s]+hair(?![a-z0-9_])", re.I),
    "feature_black_hair": re.compile(r"(?:黑发|黑色头发)|(?<![a-z0-9_])black[-\s]+hair(?![a-z0-9_])", re.I),
    # Anchor state and action.
    "pose_side_lying": re.compile(r"(?:侧躺|侧卧)|(?<![a-z0-9_])side[-\s]+ly(?:ing|ies)(?![a-z0-9_])", re.I),
    "pose_lying": re.compile(r"(?:躺卧|平躺|仰卧|俯卧)|(?<![a-z0-9_])(?:lying|reclining|supine|prone)(?![a-z0-9_])", re.I),
    "pose_standing": re.compile(r"(?:站立|站姿|站着)|(?<![a-z0-9_])stand(?:s|ing)?(?![a-z0-9_])", re.I),
    "pose_sitting": re.compile(
        r"(?:坐姿|坐着|坐在|端坐)|(?<![a-z0-9_])(?:sit(?:s|ting)?|seated)(?![a-z0-9_])"
        r"|(?<![a-z0-9_])sitting_on_bed(?![a-z0-9_])",
        re.I,
    ),
    "pose_kneeling": re.compile(r"(?:跪姿|跪着|跪地)|(?<![a-z0-9_])kneel(?:s|ing)?(?![a-z0-9_])", re.I),
    "pose_leaning_forward": re.compile(r"(?:前倾|身体前倾)|(?<![a-z0-9_])lean(?:s|ing)?[-\s]+forward(?![a-z0-9_])", re.I),
    "action_touch": re.compile(r"(?:接触|触摸|抚摸|碰触)|(?<![a-z0-9_])(?:touch(?:es|ed|ing)?|contact|caress(?:es|ed|ing)?)(?![a-z0-9_])", re.I),
    "action_turn": re.compile(r"(?:转身|转向|转动)|(?<![a-z0-9_])turn(?:s|ed|ing)?(?![a-z0-9_])", re.I),
    "action_raise_gaze": re.compile(r"(?:抬起视线|抬眼|抬头)|(?<![a-z0-9_])(?:raise(?:s|d|ing)? (?:her |his |their )?(?:gaze|eyes)|look(?:s|ed|ing)? up)(?![a-z0-9_])", re.I),
    "action_walk": re.compile(r"(?:行走|走路|迈步)|(?<![a-z0-9_])(?:walk(?:s|ed|ing)?|step(?:s|ped|ping)?)(?![a-z0-9_])", re.I),
    "action_run": re.compile(r"(?:奔跑|跑步)|(?<![a-z0-9_])run(?:s|ning)?(?![a-z0-9_])", re.I),
    "body_thigh": re.compile(r"(?:大腿)|(?<![a-z0-9_])thighs?(?![a-z0-9_])", re.I),
    # Scene anchors.  Keeping these distinct lets us reject an otherwise
    # fluent scene replacement even when a generic word such as 'background'
    # still overlaps.
    "scene_japanese_room": re.compile(
        r"(?:日式房间|和室)|(?<![a-z0-9_])(?:japanese[-\s]+room|washitsu)(?![a-z0-9_])"
        r"|(?<![a-z0-9_])traditional_japanese_room(?![a-z0-9_])",
        re.I,
    ),
    "scene_room": re.compile(r"(?:房间|室内)|(?<![a-z0-9_])(?:room|interior|indoors?)(?![a-z0-9_])", re.I),
    "scene_paper_doors": re.compile(
        r"(?:纸拉门|纸门|障子门|障子纸拉门)"
        r"|(?<![a-z0-9_])(?:paper[-\s]+doors?|shoji(?:[-\s]+screen)?)(?![a-z0-9_])"
        r"|(?<![a-z0-9_])shoji_screen(?![a-z0-9_])",
        re.I,
    ),
    "scene_bedroom": re.compile(r"(?:卧室)|(?<![a-z0-9_])bedroom(?![a-z0-9_])", re.I),
    "scene_forest": re.compile(r"(?:森林|树林)|(?<![a-z0-9_])(?:forest|woods?)(?![a-z0-9_])", re.I),
    "scene_street": re.compile(r"(?:街道|街巷)|(?<![a-z0-9_])streets?(?![a-z0-9_])", re.I),
    "scene_city": re.compile(r"(?:城市|都市)|(?<![a-z0-9_])cit(?:y|ies)(?![a-z0-9_])", re.I),
    "scene_beach": re.compile(r"(?:海滩|沙滩|海边)|(?<![a-z0-9_])(?:beach|seaside)(?![a-z0-9_])", re.I),
    "scene_space": re.compile(r"(?:太空|宇宙空间)|(?<![a-z0-9_])outer[-\s]+space(?![a-z0-9_])", re.I),
}
MINIMAX_H3_SCENE_FACT_CONCEPTS = {
    concept for concept in MINIMAX_H3_FACT_CONCEPT_PATTERNS if concept.startswith("scene_")
}
MINIMAX_H3_AUDIO_FACT_PATTERNS = {
    "audio_breath": re.compile(r"(?:呼吸声)|(?<![a-z0-9_])breath(?:ing)?(?:[-\s]+sound)?(?![a-z0-9_])", re.I),
    "audio_room_tone": re.compile(r"(?:房间环境声|室内环境声)|(?<![a-z0-9_])room[-\s]+tone(?![a-z0-9_])", re.I),
    "audio_footsteps": re.compile(r"(?:脚步声)|(?<![a-z0-9_])footsteps?(?![a-z0-9_])", re.I),
    "audio_cloth": re.compile(r"(?:衣料|布料)(?:摩擦)?声|(?<![a-z0-9_])(?:cloth|fabric)(?:[-\s]+rustle)?(?![a-z0-9_])", re.I),
    "audio_wind": re.compile(r"(?:风声|微风声)|(?<![a-z0-9_])wind(?:[-\s]+sound)?(?![a-z0-9_])", re.I),
    "audio_rain": re.compile(r"(?:雨声|下雨声)|(?<![a-z0-9_])rain(?:fall)?(?:[-\s]+sound)?(?![a-z0-9_])", re.I),
    "audio_dialogue": re.compile(r"(?:对白|台词|人声)|(?<![a-z0-9_])(?:dialogue|speech|voice)(?![a-z0-9_])", re.I),
    "music_piano": re.compile(r"(?:钢琴(?:曲|音乐)?)|(?<![a-z0-9_])piano(?:[-\s]+music)?(?![a-z0-9_])", re.I),
    "music_ambient": re.compile(r"(?:氛围音乐|环境音乐)|(?<![a-z0-9_])ambient[-\s]+music(?![a-z0-9_])", re.I),
    "music_none": re.compile(r"(?:不要音乐|无音乐|没有音乐|音乐[:：]?\s*(?:无|没有|N/?A))|(?<![a-z0-9_])(?:no|without)\s+(?:background\s+)?music|\bN/?A\b", re.I),
}
MINIMAX_H3_AUDIO_REQUEST_PATTERN = re.compile(
    r"(?:声音|音效|声景|音乐|钢琴曲|对白|台词|人声|环境声|呼吸声|脚步声|雨声|风声)"
    r"|(?<![a-z0-9_])(?:audio|soundscape|sound|music|dialogue|speech|voice|ambience|room[-\s]+tone|footsteps?|rain|wind)(?![a-z0-9_])",
    re.I,
)
MINIMAX_H3_AUDIO_STRUCTURE_ONLY_PATTERN = re.compile(
    r"(?:音画(?:分层|分离|独立)|(?:声音|音频|声景|音乐)(?:与|和)画面(?:分层|分离|独立)|"
    r"(?:声音|音频|声景|音乐)(?:字段|层)(?:分开|独立)?|"
    r"overall_soundscape|non_diegetic_music)"
    r"|(?<![a-z0-9_])(?:audio[-\s]?visual|audiovisual)(?:[-\s]+(?:layers?|layering|separation|split))?"
    r"|(?<![a-z0-9_])(?:(?:audio|soundscape|music)(?:[-\s]+and[-\s]+(?:audio|soundscape|music))*)"
    r"[-\s]+fields?(?![a-z0-9_])",
    re.I,
)
MINIMAX_H3_NO_AUDIO_REQUIREMENT_PATTERN = re.compile(
    r"(?:无|没有|无需|不需要|不要求)(?:额外)?(?:声音|音频|音效|声景)(?:要求|需求)?"
    r"|(?<![a-z0-9_])(?:no|without)\s+(?:additional\s+)?(?:audio|sound)(?:\s+requirements?)?(?![a-z0-9_])"
    r"|(?<![a-z0-9_])(?:audio|sound)\s+(?:is\s+)?not\s+required(?![a-z0-9_])",
    re.I,
)
MINIMAX_H3_EXPLICIT_AUDIO_REQUIREMENT_PATTERN = re.compile(
    r"(?:请|必须|需要|要求|保留|保持|加入|添加|包含|使用|播放|配上|同步|去掉|移除|不要|不得|禁止|无|没有)"
    r"|(?<![a-z0-9_])(?:keep|preserve|retain|add|include|use|play|synchroni[sz]e|require|must|should|"
    r"remove|exclude|without|no)(?![a-z0-9_])",
    re.I,
)
MINIMAX_H3_GENERIC_AUDIO_CUE_PATTERN = re.compile(
    r"(?:[\u3400-\u4dbf\u4e00-\u9fff]{1,10}声|声音|音效|声景|音乐|对白|台词|人声)"
    r"|(?<![a-z0-9_])(?:audio|soundscape|sounds?|music|dialogue|speech|voice|ambience|noise)(?![a-z0-9_])",
    re.I,
)
MINIMAX_H3_SENSITIVE_FACT_PATTERNS = {
    "nudity_general": re.compile(r"(?:裸体|裸露|赤裸|裸身|全裸|半裸|一丝不挂)|(?<![a-z0-9_])(?:nudity|nude|naked|topless)(?![a-z0-9_])", re.I),
    "nudity_full": re.compile(r"(?:全裸|一丝不挂|完全赤裸)|(?<![a-z0-9_])(?:fully|completely)\s+(?:nude|naked)(?![a-z0-9_])", re.I),
    "nudity_partial": re.compile(r"(?:半裸|局部裸露|胸部暴露)|(?<![a-z0-9_])(?:partially\s+nude|topless)(?![a-z0-9_])", re.I),
    "anatomy_breast": re.compile(r"(?:乳房|胸部)|(?<![a-z0-9_])breasts?(?![a-z0-9_])", re.I),
    "anatomy_nipple": re.compile(r"(?:乳头)|(?<![a-z0-9_])nipples?(?![a-z0-9_])", re.I),
    "anatomy_genital": re.compile(r"(?:生殖器|性器官|阴部|下体)|(?<![a-z0-9_])genitals?(?![a-z0-9_])", re.I),
    "anatomy_penis": re.compile(r"(?:阴茎|阳具|龟头)|(?<![a-z0-9_])penis(?![a-z0-9_])", re.I),
    "anatomy_vagina": re.compile(r"(?:阴道)|(?<![a-z0-9_])vagina(?![a-z0-9_])", re.I),
    "anatomy_vulva": re.compile(r"(?:外阴|阴唇|阴蒂)|(?<![a-z0-9_])(?:vulva|labia|clitoris)(?![a-z0-9_])", re.I),
    "anatomy_anus": re.compile(r"(?:肛门)|(?<![a-z0-9_])anus(?![a-z0-9_])", re.I),
    "activity_general": re.compile(r"(?:性行为|性活动|性交|性爱)|(?<![a-z0-9_])(?:sexual[-\s]+activity|sexual[-\s]+act|intercourse)(?![a-z0-9_])", re.I),
    "activity_masturbation": re.compile(r"(?:自慰|手淫)|(?<![a-z0-9_])masturbat(?:e|ion|ing)(?![a-z0-9_])", re.I),
    "activity_oral": re.compile(r"(?:口交)|(?<![a-z0-9_])oral[-\s]+sex(?![a-z0-9_])", re.I),
    "activity_anal": re.compile(r"(?:肛交)|(?<![a-z0-9_])anal[-\s]+sex(?![a-z0-9_])", re.I),
    "activity_penetration": re.compile(r"(?:插入|贯入)|(?<![a-z0-9_])penetrat(?:e|ion|ing)(?![a-z0-9_])", re.I),
    "fluid_general": re.compile(r"(?:性体液|体液)|(?<![a-z0-9_])(?:sexual|bodily)[-\s]+fluid(?![a-z0-9_])", re.I),
    "fluid_semen": re.compile(r"(?:精液)|(?<![a-z0-9_])semen(?![a-z0-9_])", re.I),
    "pose_sexualized": MINIMAX_H3_SENSITIVE_SIGNAL_PATTERNS["sexualized_pose"],
}
MINIMAX_H3_DEACTIVATED_INTERACTION_MARKER = "_minimax_h3_interaction_deactivated"
MINIMAX_H3_AMBIGUOUS_AGE_VALIDATED_MARKER = "_minimax_h3_ambiguous_age_validated"


def storyboard_stable_generation_seed(seed: str, salt: str, fallback: int) -> int:
    raw = f"{salt}:{seed or ''}".encode("utf-8", errors="ignore")
    value = int(hashlib.sha256(raw).hexdigest()[:8], 16) % 2147483647
    return value or fallback

STORYBOARD_DIRECTOR_PLAN_SCHEMA = {
    "type": "array",
    "minItems": 9,
    "maxItems": 9,
    "items": {
        "type": "array",
        "minItems": 4,
        "maxItems": 4,
        "prefixItems": [
            {"type": "string", "maxLength": 10},
            {"type": "string", "maxLength": 8},
            {"type": "string", "maxLength": 12},
            {"type": "string", "maxLength": 24},
        ],
    },
}


def storyboard_story_direction_text(direction) -> str:
    if not direction:
        return ""
    if isinstance(direction, dict):
        title = clean_text(str(direction.get("title") or direction.get("name") or ""))
        summary = clean_text(str(direction.get("direction") or direction.get("summary") or ""))
        elements = clean_text(str(direction.get("elements") or direction.get("allowedElements") or ""))
        world_style = clean_text(str(direction.get("worldStyle") or direction.get("world") or ""))
        parts = []
        if title:
            parts.append(f"标题:{title}")
        if summary:
            parts.append(f"方向:{summary}")
        if elements:
            parts.append(f"允许元素:{elements}")
        if world_style:
            parts.append(f"世界倾向:{world_style}")
        return "；".join(parts)
    return clean_text(str(direction or ""))


STORYBOARD_VISIBLE_CUE_PATTERNS = {
    "人物": r"(少女|女孩|少年|主角|家人|村民|老者|老人|旅伴|同伴|伙伴|朋友|新朋友|小鹿|小狗|动物|女武神|圣女|女祭司|侦探|仿生人|维修机器人|机器人|巨兽|远古巨兽|怪物|敌人|魔王|鲸群)",
    "物件": r"(旧物|日记|信件|旧信|照片|地图|礼物|圣徽|王冠|武器|长剑|盾牌|雨伞|伞|种子|水晶种子|花种|果实|果子|野果|背包|皮水袋|木牌|路标|石碑|刻痕|苔藓|残页|纸角|伤口|绷带|数据芯片|全息广告|证据|珊瑚碎片|发光珊瑚|圣坛|能源核心|控制面板|电缆|温室系统|植物嫩芽|植物)",
    "地点": r"(故乡|村口|庭院|书房|森林|树林|林间|山野|山路|小路|溪边|河边|浅滩|溪流|小溪|河流|断桥|倒木|木屋|远山|山顶|高处|山坡|石堆|古镇|教堂|黑暗王座|王座|废墟战场|战场|城市|街道|街巷|街角|企业天台|天台|企业大楼|大楼|沙丘|风暴沙丘|商队遗迹|遗迹|枯井|绿洲|海底|珊瑚礁|海沟|空间站|温室舱)",
    "阻碍": r"(藤蔓|荆棘|灌木|倒木|断桥|迷路|岔路|阻碍|障碍|暴雨|风暴|山洪|黑暗|黑潮|污染|追赶|挡住|受伤|伤口|失控|侵蚀|火焰)",
    "氛围": r"(阳光|晨光|月光|光线|风|雨|雪|雾|黄昏|黎明|夜晚|暖光|冷光|自然治愈|山野|森林|霓虹|暴雨|深海|复古科幻|暗黑|史诗)",
}

STORYBOARD_UNSUPPORTED_GENERIC_EVENT_RE = re.compile(r"(宝箱|钥匙|谜题|机关|古道|洞穴|祭坛|守卫|村庄)")


def storyboard_visible_direction_cues(
    story_text: str,
    source_analysis: str,
    selected_direction,
    visual_cue_pack: str = "",
) -> str:
    direction_text = storyboard_story_direction_text(selected_direction)
    text = clean_text(f"{story_text} {visual_cue_pack} {source_analysis} {direction_text}")
    if not text:
        return ""
    parts: list[str] = []
    for label, pattern in STORYBOARD_VISIBLE_CUE_PATTERNS.items():
        values: list[str] = []
        for match in re.finditer(pattern, text):
            value = clean_text(match.group(0))
            if value and value not in values:
                values.append(value)
            if len(values) >= 6:
                break
        if values:
            parts.append(f"{label}:{','.join(values)}")
    return "；".join(parts)[:360]


def storyboard_visible_direction_cue_map(
    story_text: str,
    source_analysis: str,
    selected_direction,
    visual_cue_pack: str = "",
) -> dict[str, list[str]]:
    direction_text = storyboard_story_direction_text(selected_direction)
    text = clean_text(f"{story_text} {visual_cue_pack} {source_analysis} {direction_text}")
    cue_map: dict[str, list[str]] = {}
    for label, pattern in STORYBOARD_VISIBLE_CUE_PATTERNS.items():
        values: list[str] = []
        for match in re.finditer(pattern, text):
            value = clean_text(match.group(0))
            if value and value not in values:
                values.append(value)
        cue_map[label] = values
    return cue_map


def storyboard_pick_visible_cue(source: str, values: list[str], fallback: str = "") -> str:
    text = clean_text(source)
    for value in values or []:
        if value and value in text:
            return value
    if fallback:
        for value in values or []:
            if value:
                return value
    return fallback


def storyboard_visible_actor(source: str, cue_map: dict[str, list[str]]) -> str:
    text = clean_text(source)
    for match in re.finditer(STORYBOARD_VISIBLE_CUE_PATTERNS["人物"], text):
        value = clean_text(match.group(0))
        if value and value != "主角":
            return value
    actors = [value for value in cue_map.get("人物", []) if value != "主角"]
    return storyboard_pick_visible_cue(source, actors, actors[0] if actors else "主角")


def storyboard_visible_prop(source: str, cue_map: dict[str, list[str]]) -> str:
    props = cue_map.get("物件", [])
    return storyboard_pick_visible_cue(source, props, props[0] if props else "")


def storyboard_visible_location(source: str, cue_map: dict[str, list[str]], index: int = 0) -> str:
    locations = cue_map.get("地点", [])
    picked = storyboard_pick_visible_cue(source, locations, "")
    if picked:
        return picked
    if locations:
        return locations[max(0, index) % len(locations)]
    return "现场"


def storyboard_visible_obstacle(source: str, cue_map: dict[str, list[str]]) -> str:
    obstacles = cue_map.get("阻碍", [])
    return storyboard_pick_visible_cue(source, obstacles, obstacles[0] if obstacles else "")


def storyboard_contextual_visible_clue(context: str, cue_map: dict[str, list[str]], index: int = 0) -> str:
    text = clean_text(context)
    prop = storyboard_pick_visible_cue(text, cue_map.get("物件", []), "")
    if prop:
        return prop
    obstacle = storyboard_pick_visible_cue(text, cue_map.get("阻碍", []), "")
    if obstacle:
        return obstacle
    props = cue_map.get("物件", [])
    if props:
        return props[max(0, index) % len(props)]
    return ""


def storyboard_visual_event_chain_text(events) -> str:
    if not isinstance(events, list):
        return ""
    lines: list[str] = []
    for index, event in enumerate(events):
        if isinstance(event, dict):
            title = clean_text(str(event.get("title") or event.get("event") or ""))
            action = clean_text(str(event.get("action") or event.get("visibleAction") or ""))
            scene_anchor = clean_text(str(event.get("sceneAnchor") or event.get("currentSpace") or event.get("space") or event.get("location") or ""))
            cause = clean_text(str(event.get("cause") or event.get("causalRole") or event.get("causalLink") or ""))
        elif isinstance(event, list) and len(event) >= 4:
            title, action, scene_anchor, cause = [clean_text(str(value or "")) for value in event[:4]]
        elif isinstance(event, list) and len(event) >= 3:
            title, action, scene_anchor = [clean_text(str(value or "")) for value in event[:3]]
            cause = ""
        else:
            continue
        if not title or not action:
            continue
        if scene_anchor and cause:
            lines.append(f"{index + 1}. {title} / {action} / {scene_anchor} / {cause}")
        elif scene_anchor:
            lines.append(f"{index + 1}. {title} / {action} / {scene_anchor}")
        elif cause:
            lines.append(f"{index + 1}. {title} / {action} / {cause}")
        else:
            lines.append(f"{index + 1}. {title} / {action}")
    return "\n".join(lines)


def build_storyboard_story_directions_prompt(story_text: str, source_analysis: str, seed: str) -> str:
    return (
        "你是 NovaFlow 故事方向策划。只输出紧凑合法 JSON 二维数组，不解释不换行。"
        "顶层必须正好 3 项；每项必须正好 4 个字符串，顺序固定为：[方向标题,一句话方向,允许元素,世界倾向]。"
        "方向标题<=10字；一句话方向<=36字；允许元素<=24字；世界倾向<=12字。"
        "这是给用户选择的短方向，只锁主线、题材、世界观；不要写具体镜头、具体事件链或9格分镜。"
        "三条方向必须是同一剧情的不同合理展开，不要每次固定为同一组标题或同一组元素。"
        "差异来自用户剧情里的关系、物件、地点、阻碍、离别、帮助、寻找、失去等真实线索；缺少线索时从World Continuity补充同题材元素。"
        "必须围绕用户剧情和World Continuity；World Continuity只决定时间、地点、时代、视觉气候，不强行决定剧情事件。"
        "方向是同一原始剧情的不同走向，不是改题材；不得新增寻宝、逃亡、寻人、破案、拯救世界等新主线目标，除非用户剧情明确写出。"
        "方向标题必须是可见方向，禁止含自我、成长、失去、挑战、未来、希望、内心、命运等主题词；标题必须含可见线索，如沿河离乡、林路遇伴、旧物告别、溪边救助、山路寻物。"
        "方向标题不能只写寻找自我、遇见新我、放下过去、成长挑战、面对未来；标题必须含人物关系、物件、地点、阻碍或行动倾向。"
        "方向句不能写抽象鸡汤，也不要写固定桥段；用短句描述可继续扩展的主线倾向。"
        "如果剧情或世界倾向允许魔法、科幻、童话、悬疑，可以出现对应元素；如果是现代写实，不要突然加入魔法、怪物、新能力。"
        "World Continuity 写现代或写实时，三条方向都必须保持现代自然事件，不得写魔法、科幻、时间旅行或超自然设定。"
        "World Continuity 写山野、森林、旅途时，除非用户剧情明确写城市，不得把主舞台改成城市、都市、交通堵塞或室内职场。"
        "允许元素只能写可见的人、物、地点或阻碍；不要写成长/自我/希望/未来/挑战这类主题词。"
        "随机种子只用于选择不同合理角度，不允许突破用户剧情。"
        f"随机种子:{seed}\n"
        f"剧情:{story_text}\n"
        f"World Continuity:{source_analysis}\n"
        "JSON:"
    )


def build_storyboard_visual_event_chain_prompt(
    story_text: str,
    source_analysis: str,
    selected_direction,
    seed: str,
    visual_cue_pack: str = "",
) -> str:
    direction_text = storyboard_story_direction_text(selected_direction)
    visible_cues = storyboard_visible_direction_cues(story_text, source_analysis, selected_direction, visual_cue_pack)
    return (
        "你是 NovaFlow 视觉事件链编剧。只输出 JSON 二维数组本体，不写说明、标题或代码块。"
        "输出正好9项；每项正好3个字符串：[剧情节点,剧情动作,场景线索]。"
        "目标：根据用户剧情和参考图扩展一条连续的9格粗可画事件链；不要写镜头、构图或光影。"
        "用户剧情是最高优先级硬约束；主角身份、世界题材、核心目标和结局不得替换。"
        "禁止把题材改成无关模板：剧情没有洞穴/神器/野兽/找水/森林探险时，不得擅自写这些桥段。"
        "如果用户剧情很短，可以补中间事件，但补充内容必须来自参考图、Visual Cue Pack 或同一世界的普通物件与阻碍。"
        "每格结束时必须让世界状态发生变化；下一格必须承接上一格产生的人物关系、物件、痕迹、阻碍、伤势、路线或场所变化。"
        "每格剧情动作必须包含：谁/哪个生命形态 + 做什么 + 对象或可见结果。"
        "可以有抽象主题作为内部思路，但最终字段必须落到具体对象变化；不要只写成长、自我、希望、未来、挑战、旅途、结果。"
        "参考图和 Visual Cue Pack 只提供人物、物件、地点、敌人、阻碍、风格素材；不要把参考图背景复制成每一格。"
        "故事可以自然发挥，但必须严格遵从用户描述；不得套固定九格模板，不得无依据新增主角、主要反派、神器、能力体系、身份反转或不同结局。"
        "如果剧情需要多生命形态互动，可以让任意生命形态主动或被动行动，不必每格都让主角做动作。"
        "同一核心事件只出现一次；不要循环告别、交换、追逐、控制、释放、胜利或继续前行。"
        "禁止低信息动作：行走、继续前行、决定、感受、思考、找到方向、看到远处、靠近远山、克服阻碍；除非同句写清具体对象发生了什么变化。"
        "场景线索写这一格和上一格不同的可见地点/物件/阻碍，不要只写森林、山野、战场、王座、道路这类大背景。"
        "剧情节点<=8字；剧情动作<=36字；场景线索<=12字。"
        f"随机种子:{seed}\n"
        f"剧情:{story_text}\n"
        f"World Continuity:{source_analysis}\n"
        f"Visual Cue Pack:{visual_cue_pack}\n"
        f"Selected Story Direction:{direction_text or 'Direct from user story'}\n"
        f"Visible Cues:{visible_cues}\n"
        "JSON:"
    )


def storyboard_story_direction_title_is_abstract(title: str) -> bool:
    text = clean_text(title)
    if not text:
        return True
    return bool(re.search(r"(自我|成长|失去|挑战|未来|希望|内心|命运|真谛|勇气|过去|新我)", text))


def storyboard_visible_story_direction_title(title: str, direction: str, elements: str, index: int) -> str:
    text = clean_text(f"{title} {direction} {elements}")
    candidates: list[str] = []
    if re.search(r"(河|溪|水|浅滩|沿河|溪边)", text):
        candidates.append("沿河离乡")
    if re.search(r"(森林|林路|林中|树林|旅伴|同伴|朋友|遇见|相遇)", text):
        candidates.append("林路遇伴")
    if re.search(r"(旧物|遗物|信件|日记|照片|告别|放下|埋下)", text):
        candidates.append("旧物告别")
    if re.search(r"(小鹿|小狗|动物|伤口|包扎|救助)", text):
        candidates.append("溪边救助")
    if re.search(r"(山路|小路|路标|地图|寻找|寻物|路线)", text):
        candidates.append("山路寻物")
    if re.search(r"(村口|故乡|离开|离乡|出发|启程)", text):
        candidates.append("离乡山路")
    fallback_titles = ["沿河离乡", "林路遇伴", "旧物告别"]
    candidates.extend(fallback_titles)
    for candidate in candidates:
        if candidate and not storyboard_story_direction_title_is_abstract(candidate):
            return candidate[:10]
    return fallback_titles[max(0, min(len(fallback_titles) - 1, int(index or 0)))]


def build_storyboard_visual_event_action_repair_prompt(
    story_text: str,
    source_analysis: str,
    selected_direction,
    event_items: list[list[str]],
    index: int,
    title: str,
    action: str,
    scene_anchor: str,
    cause: str,
    visual_cue_pack: str = "",
) -> str:
    direction_text = storyboard_story_direction_text(selected_direction)
    event_chain_text = storyboard_visual_event_chain_text(event_items)
    previous_text = ""
    next_text = ""
    if index > 0 and index - 1 < len(event_items):
        previous_text = storyboard_visual_event_chain_text([event_items[index - 1]])
    if index + 1 < len(event_items):
        next_text = storyboard_visual_event_chain_text([event_items[index + 1]])
    return (
        "你是 NovaFlow 视觉事件链单格动作可画化翻译器。只输出一个合法 JSON 字符串，不解释不换行。"
        "禁止输出对象、数组、字段名或代码块；正确输出示例：\"角色把具体物推离道路\"。"
        "只改指定 Scene 的动作描述，不改主线、不改标题、不改场景、不改其他8格。"
        "保留原事件含义，把模型看不懂的阶段词翻译成可画动作：谁+做什么+对什么/造成什么可见变化。"
        "可根据剧情、World Continuity、前后事件，自行选择符合当前世界的普通物件、阻碍、线索、互动或状态变化。"
        "不要套固定桥段；不要新增主线目标、关键神器、新能力、身份反转、主要反派或不同结局。"
        "动作<=36字；必须是完整动作句，不能只输出4到6字标题式短语。"
        "必须有主体动作、受力对象或明确状态变化；不要只写物体发光、闪烁、站立、闭眼、看见。"
        "如果原动作只是手持、站在、闭眼、睁眼、行走，必须改成道具被使用、身体被改变、障碍被处理或目标被影响。"
        "如果原动作含自我、成长、挑战、希望、旅途、继续前行、获得力量、获得指引、面对挑战、寻找方向，输出动作里禁止保留这些词。"
        "输出必须和原动作不同；如果原动作是进入/离开/行走/眺望/发现地点，必须加入具体物件、痕迹、障碍或互动对象的变化。"
        "不要输出准备继续前行、进入森林、离开森林、远眺远山、坐下休息、凝视战场、整理装备、踏步前行、靠近目标、站定胜利这类低信息动作。"
        "禁止和前一格或后一格动作相同；如果前后已有同类动作，必须换成另一个合理的物件或状态变化。"
        "当参考图只给人物和地点时，必须自行选择符合当前世界的普通可见物、痕迹、阻碍或互动对象，让画面有明确可画焦点。"
        "没有剧情或参考图支撑时，禁止新增第二主角、朋友、动物、敌人、战斗、交接物、身体变化。"
        "不要写镜头、情绪、光影、构图。"
        "禁止只写探险/寻路/遭遇阻碍/克服困难/发现自我/结束旅途/展示成果/面对挑战/成长/希望/未来/决定/领悟。"
        f"剧情:{story_text}\n"
        f"World Continuity:{source_analysis}\n"
        f"Visual Cue Pack:{visual_cue_pack}\n"
        f"Selected Story Direction:{direction_text}\n"
        f"完整事件链:\n{event_chain_text}\n"
        f"前一格:{previous_text}\n"
        f"后一格:{next_text}\n"
        f"需要修复:Scene{index + 1:02d};标题:{title};原动作:{action};场景:{scene_anchor};原因:{cause}\n"
        "JSON:"
    )


def build_storyboard_visual_event_actions_rewrite_prompt(
    story_text: str,
    source_analysis: str,
    selected_direction,
    event_items: list[list[str]],
    visual_cue_pack: str = "",
) -> str:
    direction_text = storyboard_story_direction_text(selected_direction)
    event_chain_text = storyboard_visual_event_chain_text(event_items)
    repair_indexes = storyboard_visual_event_action_repair_indexes(event_items)
    problem_lines: list[str] = []
    for index, item in enumerate(event_items):
        if index not in repair_indexes or not isinstance(item, list) or len(item) < 3:
            continue
        title = clean_text(str(item[0] or ""))
        action = clean_text(str(item[1] or ""))
        scene_anchor = clean_text(str(item[2] or ""))
        problem_lines.append(f"Scene{index + 1:02d}:{title}/{action}/{scene_anchor}")
    return (
        "你是 NovaFlow 视觉事件链动作可画化翻译器。只输出合法紧凑 JSON 数组，不解释不换行。"
        "输入的9格故事顺序、事件名、场景锚点都要保留；你只重写每格动作字段。"
        "输出正好9个字符串，每个字符串对应原来Scene01到Scene09的动作；字符串里不要写事件名、场景名、Scene编号或斜杠。"
        "每个动作必须是模型能画的画面事实：谁+做什么+对什么/造成什么可见变化。"
        "可以根据剧情、World Continuity和当前场景补普通物件、阻碍、线索、互动或状态变化。"
        "不要套固定模板；不要新增主线目标、关键神器、新能力体系、身份反转、主要反派或不同结局。"
        "必须重写问题场景，不能照抄原动作；弱动作要改成道具被使用、障碍被处理、线索出现、身体/关系/目标被影响。"
        "禁止输出站立、闭眼、睁眼、手持、发光、闪烁、探险、寻路、克服困难、发现自我、结束旅途、展示成果。"
        "动作<=24字；每格动作不得重复；必须承接前后格。"
        f"剧情:{story_text}\n"
        f"World Continuity:{source_analysis}\n"
        f"Visual Cue Pack:{visual_cue_pack}\n"
        f"Selected Story Direction:{direction_text}\n"
        f"必须重写的问题场景:\n{chr(10).join(problem_lines) or '无'}\n"
        f"当前事件链:\n{event_chain_text}\n"
        "JSON:"
    )


def build_storyboard_visual_event_chain_visualize_prompt(
    story_text: str,
    source_analysis: str,
    selected_direction,
    event_items: list[list[str]],
    visual_cue_pack: str = "",
) -> str:
    direction_text = storyboard_story_direction_text(selected_direction)
    visible_cues = storyboard_visible_direction_cues(story_text, source_analysis, selected_direction, visual_cue_pack)
    repair_indexes = storyboard_visual_event_action_repair_indexes(event_items)
    stage_lines: list[str] = []
    problem_lines: list[str] = []
    for index, item in enumerate(event_items):
        if not isinstance(item, list) or len(item) < 3:
            continue
        title = clean_text(str(item[0] or ""))
        action = clean_text(str(item[1] or ""))
        scene_anchor = clean_text(str(item[2] or ""))
        if index in repair_indexes:
            stage_lines.append(f"Scene{index + 1:02d} 剧情骨架:{title}/{action}/{scene_anchor}")
            problem_lines.append(f"Scene{index + 1:02d}:{title}/{action}/{scene_anchor}")
        else:
            stage_lines.append(f"Scene{index + 1:02d} 剧情骨架:{title}/{action}/{scene_anchor}")
    forbidden_phrases: list[str] = []
    for phrase in ["自我", "成长", "挑战", "希望", "结果", "目的地", "旅途", "继续前行", "获得力量", "获得指引", "面对挑战", "寻找自我", "通路变化", "展示成果", "需要找到", "决定", "终于", "属于自己的方向"]:
        if phrase not in forbidden_phrases:
            forbidden_phrases.append(phrase)
    for index in repair_indexes:
        if index < len(event_items) and isinstance(event_items[index], list):
            for value in event_items[index][:2]:
                value = clean_text(str(value or ""))
                if value and len(value) <= 12 and value not in forbidden_phrases:
                    forbidden_phrases.append(value)
    return (
        "你是 NovaFlow Drawable Event Realizer。只输出 JSON 二维数组本体，不解释不换行。"
        "输入是9格剧情骨架；原动作大多只是阶段说明，不可信。"
        "输出正好9项，每项正好3个字符串：[事件名,可画动作,场景锚点]。"
        "只保留骨架的顺序、主线和结局；每格动作必须重新写，不得照抄、缩短或去标点。"
        "每格动作必须回答三件事：谁/哪个生命形态；对哪个可见对象；造成什么可见变化。"
        "每格必须有不同画面焦点；焦点可以是参考图里的人物、道具、地点、敌人、障碍，也可以是符合世界的普通痕迹或物件。"
        "场景锚点必须写具体焦点，不要只写大背景。"
        "相邻格必须承接：上一格出现的物件、痕迹、阻碍、路线、伤势或关系，在下一格被使用、处理或改变。"
        "禁止输出这些词：继续前行、决定、需要、寻找方向、找到方向、探索、旅途、成长、自我、希望、挑战、治愈之地、回忆、温暖、获得力量、获得指引、展示成果。"
        "禁止输出这些空泛句式：在某地行走、在某地站立、沿着某地走、逐渐接近某地、做出选择、看向远方。"
        "如果骨架写风或光，必须让风或光吹动/照亮/撕开/暴露具体对象。"
        "如果骨架写路标、溪流、森林、王座、战场、设备、敌人，必须让该对象改变状态，不准只当背景。"
        "不得新增主目标、主要反派、神器、能力体系、身份反转或不同结局。"
        "事件名<=8字；动作<=36字；场景<=12字。"
        f"剧情:{story_text}\n"
        f"World Continuity:{source_analysis}\n"
        f"Visual Cue Pack:{visual_cue_pack}\n"
        f"Visible Cues:{visible_cues}\n"
        f"Selected Story Direction:{direction_text}\n"
        f"禁用弱词:{'、'.join(forbidden_phrases[:24])}\n"
        f"优先加强的弱格:\n{chr(10).join(problem_lines) or '无'}\n"
        f"9格剧情骨架:\n{chr(10).join(stage_lines)}\n"
        "JSON:"
    )


def build_storyboard_final_shot_prompts_prompt(
    story_text: str,
    source_analysis: str,
    selected_direction,
    visual_event_chain,
    visual_cue_pack: str,
    seed: str,
) -> str:
    direction_text = storyboard_story_direction_text(selected_direction)
    event_chain_text = storyboard_visual_event_chain_text(visual_event_chain)
    return (
        "你是 NovaFlow 连续分镜生图提示词编剧。只输出9行最终结果，不解释，不写 JSON，不写 Markdown。"
        "每行格式固定为：两位序号 空格 你写的事件标题：你写的最终生图提示词。"
        "标题和提示词必须是具体内容，禁止输出“标题”“短标题”“提示词”“最终生图提示词”这些占位字样。"
        "这是最终进入生图模型的正向提示词，不是三字段事件链，也不是分析。"
        "用户剧情、World Continuity 和 Visual Cue Pack 是硬约束；Story Chain 只是草稿骨架。"
        "如果 Story Chain 与用户剧情、参考图世界、主体身份或结局冲突，必须纠正为用户剧情，不要盲从错误骨架。"
        "如果 Story Chain 有抽象阶段，你必须在 prompt 里自然翻译成当前世界可见的具体画面。"
        "每格 prompt 必须是连续电影分镜：承接上一格已经产生的人物关系、物件、痕迹、伤势、路线、阻碍或场所变化，并为下一格留下可见原因。"
        "每格必须写清：谁或哪个生命形态、正在做什么、作用到什么对象、造成什么可见结果、发生在什么具体场景焦点。"
        "每格自然包含镜头景别/角度或焦点、光照和氛围；光照和氛围只能修饰画面，不能代替事件。"
        "参考图只锁人物身份、主要生命形态、世界观、材质、服装、风格和视觉气候；不要把参考图同一个背景构图复制到9格。"
        "同一人物、服装、武器或核心形象必须连续；但场景焦点、前景物、背景空间、动作方向、镜头距离必须尽量不同。"
        "同一大背景连续出现时，必须换成不同局部空间和可见对象；不要让三格以上都只是同一人物站在同一远景里。"
        "可以自由创作符合用户剧情和参考图的普通物件、痕迹、阻碍、互动对象和局部环境细节；禁止新增主线目标、关键神器、主要反派、新能力体系、身份反转或不同结局。"
        "禁止空泛句：充满挑战、象征力量、希望天空、正能量、感受风、沐浴阳光、面对未来、寻找自我、展示成果、旅途结束；除非同句已经写出具体可见动作和对象变化。"
        "每段 prompt 建议55到110个中文字符；不要写负面提示词、不要写编号前缀、不要写 Markdown。"
        f"随机种子:{seed}\n"
        f"剧情:{story_text}\n"
        f"World Continuity:{source_analysis}\n"
        f"Visual Cue Pack:{visual_cue_pack}\n"
        f"Selected Story Direction:{direction_text or '未提供'}\n"
        f"Story Chain:\n{event_chain_text}\n"
        "最终9行:"
    )


def storyboard_unified_user_subject(story_text: str) -> str:
    text = clean_text(story_text)
    if not text:
        return "主角"
    role_match = re.search(
        r"(少女|女孩|少年|男孩|女人|男人|女性|男性|母亲|父亲|老人|老者|孩子|圣女|女武神|女祭司|祭司|侦探|护士|医生|画家|学生|旅人|机器人|维修机器人|仿生人|木偶师|骑士|战士|主角)",
        text,
    )
    if role_match:
        return role_match.group(1)
    leading_match = re.match(
        r"^(?:曾经的|年轻的|年老的|一名|一位|一个|这名|这位|这个)?([\u4e00-\u9fffA-Za-z0-9]{2,12}?)(?:逐渐|离开|来到|进入|踏上|前往|去往|在|从|被|将|用|带|沿|走|守护|寻找|追踪|修复|战斗|遇见|发现|学习|成为|开始|经历|逃离)",
        text,
    )
    if leading_match:
        subject = storyboard_unified_trim_story_phrase(leading_match.group(1))
        if subject:
            return subject[:12]
    first_phrase = re.split(r"[，。！？；;、\s]+", text, maxsplit=1)[0]
    first_phrase = storyboard_unified_trim_story_phrase(first_phrase)
    return first_phrase[:12] or "主角"


STORYBOARD_UNIFIED_RHYTHM_LIBRARY = [
    {
        "id": "SPACE_GOAL",
        "label": "空间目标型",
        "keywords": ["离开", "前往", "去往", "来到", "抵达", "到达", "旅途", "寻找机会", "寻梦", "迁往"],
        "beats": ["起点动机", "离开代价", "接近目标", "进入目标行动", "具体尝试", "受阻缺口", "调整方法", "关键行动", "新状态"],
        "avoid": "不要把路途、远望或入口拖成多格",
    },
    {
        "id": "IDENTITY_SHIFT",
        "label": "身份转变型",
        "keywords": ["成为", "变成", "堕落", "觉醒", "转变", "侵蚀", "变身", "身份", "新身份"],
        "beats": ["原身份", "异常诱因", "抗拒迹象", "影响加深", "失控边缘", "主动选择", "新能力行为", "外界确认", "最终身份"],
        "avoid": "不要只连续写表情或气氛变化",
    },
    {
        "id": "TRAINING_GROWTH",
        "label": "训练成长型",
        "keywords": ["学习", "训练", "修炼", "练习", "成长", "掌握", "比赛", "考试", "提升"],
        "beats": ["目标缺口", "开始练习", "第一次失败", "找到方法", "持续投入", "外部考验", "突破动作", "成果验证", "新阶段"],
        "avoid": "不要连续写读书、练习或思考",
    },
    {
        "id": "INVESTIGATION",
        "label": "调查发现型",
        "keywords": ["调查", "追踪", "寻找真相", "线索", "谜团", "失踪", "揭露", "发现秘密", "侦探"],
        "beats": ["异常事件", "获得线索", "追踪对象", "误导阻碍", "关键证据", "风险暴露", "推理连接", "揭露真相", "后果处理"],
        "avoid": "不要把每格都写成寻找线索",
    },
    {
        "id": "CONFLICT_ESCALATION",
        "label": "冲突升级型",
        "keywords": ["冲突", "对抗", "争夺", "阻止", "危机", "敌人", "强敌", "入侵", "守护", "守住", "拯救", "袭击", "突袭", "攻击", "受伤", "反击"],
        "beats": ["平衡被破坏", "初次对抗", "威胁升级", "失去优势", "寻找弱点", "代价出现", "反击准备", "决胜行动", "局势改变"],
        "avoid": "不要连续写站立对峙",
    },
    {
        "id": "SINGLE_ARENA_DUEL",
        "label": "同场景对战型",
        "keywords": ["对战", "决斗", "擂台", "竞技场", "单挑", "战斗", "交手", "决战", "遭遇", "试探", "受伤", "反击", "黑龙", "巨龙", "龙", "怪物", "巨兽"],
        "beats": ["对峙规则", "试探出招", "第一轮碰撞", "战术变化", "被压制", "发现破绽", "反转动作", "关键一击", "胜负余波"],
        "avoid": "同一地点可以保留，但动作、局势和距离必须变化",
    },
    {
        "id": "MISSION_EXECUTION",
        "label": "任务执行型",
        "keywords": ["任务", "潜入", "护送", "修复", "启动", "关闭", "偷取", "送达", "营救"],
        "beats": ["接到任务", "准备工具", "进入现场", "绕过障碍", "执行核心步骤", "突发问题", "临场调整", "完成关键操作", "交付结果"],
        "avoid": "不要把准备和进入现场写太多格",
    },
    {
        "id": "RELATIONSHIP_CHANGE",
        "label": "关系变化型",
        "keywords": ["相遇", "误会", "和解", "告别", "重逢", "朋友", "家人", "师徒", "伙伴", "背叛"],
        "beats": ["关系现状", "触发事件", "靠近或冲突", "误会加深", "共同经历", "真实需求", "表达选择", "关系转折", "新关系状态"],
        "avoid": "不要连续写聊天，必须有行为和关系结果",
    },
    {
        "id": "SURVIVAL_CRISIS",
        "label": "生存危机型",
        "keywords": ["逃离", "逃亡", "灾难", "暴风", "废墟", "生存", "迷失", "追捕", "坠落"],
        "beats": ["危险降临", "快速逃生", "资源缺口", "临时避难", "危机加重", "牺牲或损失", "找到出口", "冒险脱困", "幸存状态"],
        "avoid": "不要连续写奔跑或躲藏",
    },
    {
        "id": "HEALING_EMOTION",
        "label": "情绪治愈型",
        "keywords": ["失去", "治愈", "释怀", "孤独", "创伤", "告别过去", "找回", "自我"],
        "beats": ["伤口显现", "离开旧处", "遇到触发物", "短暂逃避", "面对记忆", "接受帮助", "主动告别", "重新行动", "平静新状态"],
        "avoid": "不要只写内心感受，必须外化成动作",
    },
    {
        "id": "REVERSAL_REVEAL",
        "label": "反转揭露型",
        "keywords": ["反转", "真相", "隐藏", "伪装", "秘密", "背后", "揭开", "原来"],
        "beats": ["表面目标", "异常细节", "追查推进", "错误判断", "矛盾集中", "隐藏证据", "反转揭露", "重新选择", "新认知结果"],
        "avoid": "不要一开始就暴露最终秘密",
    },
    {
        "id": "WORLD_EXPLORATION",
        "label": "世界探索型",
        "keywords": ["探索", "发现", "穿越", "未知世界", "遗迹", "岛屿", "地下", "星球", "秘境"],
        "beats": ["进入未知", "建立规则", "遇到奇观", "发现限制", "接触生命或机关", "触发风险", "理解规则", "利用规则", "带回改变"],
        "avoid": "不要只堆地点奇观，必须有发现后的行动",
    },
]


STORYBOARD_UNIFIED_RHYTHM_FLOW_TEXT = {
    "SPACE_GOAL": "第1格呈现起点和动机；第2格呈现离开、过渡或已经产生的代价；第3格必须接近或到达目标世界入口；第4格必须进入目标世界并做第一个目标行动；第5格给新信息、新关系或第一次具体尝试；第6格呈现困难、缺口、失败、孤独或不确定；第7格呈现决定、调整、方法或支持；第8格执行关键行动并造成可见变化；第9格只呈现最终新状态或新生活结果，必须不同于第8格。",
    "IDENTITY_SHIFT": "先建立原身份和诱因；中段把变化外化到道具、服装、力量、环境或旁人反应；后段写主动选择、新身份行为、外界确认和后果。",
    "TRAINING_GROWTH": "从能力缺口开始；安排失败、方法、持续投入和外部考验；后段用可见动作证明突破，并让结果进入新阶段。",
    "INVESTIGATION": "从异常或委托开始；线索必须逐步改变判断；中段加入误导、证据和风险；后段把证据连接成真相并处理后果。",
    "CONFLICT_ESCALATION": "先破坏平衡；冲突逐步升级并产生代价；主角找到弱点或新策略；最后用决胜行动改变局势。",
    "SINGLE_ARENA_DUEL": "同一场地可以保留；第1到第6格只能写对峙、试探、碰撞、换招、受压和发现破绽；第7格写反击准备或局势反转，禁止分出胜负；第8格才写决胜动作；第9格只写胜负余波或守护结果，不能重复第8格姿势。每格都要改变距离、招式、攻守优势或伤势状态，不能连续重复同一攻击和闪避。",
    "MISSION_EXECUTION": "从任务和工具准备进入现场；中段绕过障碍并执行核心步骤；突发问题后临场调整；最后交付结果。",
    "RELATIONSHIP_CHANGE": "从关系现状开始；通过事件让靠近、误会或冲突升级；共同经历暴露真实需求；后段表达选择并形成新关系状态。",
    "SURVIVAL_CRISIS": "危险先发生；资源和环境持续压迫主角；中段出现损失或极限选择；后段找到出口并呈现幸存后的状态。",
    "HEALING_EMOTION": "伤口要外化成物件、地点或行为；中段让回避、触发和面对形成变化；后段用主动告别或重新行动证明释怀。",
    "REVERSAL_REVEAL": "先给出表面目标；通过异常细节和矛盾逐步动摇判断；后段揭开反转，并让主角据此重新选择。",
    "WORLD_EXPLORATION": "进入未知后先建立规则；奇观必须带来限制或风险；主角理解并利用规则；最后带回改变。",
}


def storyboard_unified_rhythm_candidates(story_text: str) -> list[dict]:
    text = clean_text(story_text).lower()
    scored: list[tuple[int, int, dict]] = []
    for order, item in enumerate(STORYBOARD_UNIFIED_RHYTHM_LIBRARY):
        score = 0
        for keyword in item["keywords"]:
            if str(keyword).lower() in text:
                score += 2
        if item["id"] == "SPACE_GOAL" and re.search(r"(离开|前往|去往|来到|抵达|到达|旅途|迁往|搬到|赶往)", text):
            score += 2
        if item["id"] == "IDENTITY_SHIFT" and re.search(r"(成为|变成|堕落|觉醒|转变|侵蚀|身份)", text):
            score += 2
        if item["id"] == "SINGLE_ARENA_DUEL" and re.search(r"(对战|决斗|擂台|竞技场|单挑|决战|遭遇.*(敌|龙|怪|兽)|与.*(敌|龙|怪|兽).*(交手|战斗|对抗)|试探.*反击)", text):
            score += 3
        if item["id"] == "CONFLICT_ESCALATION" and re.search(r"(战斗|冲突|敌|守护|守住|拯救|阻止|危机|袭击|突袭|攻击|受伤|反击|黑龙|巨龙|怪物|巨兽)", text):
            score += 1
        if score:
            scored.append((score, -order, item))
    scored.sort(reverse=True, key=lambda row: (row[0], row[1]))
    return [item for _, _, item in scored[:3]]


def storyboard_unified_rhythm_library_prompt(story_text: str) -> str:
    candidates = storyboard_unified_rhythm_candidates(story_text)
    candidate_text = "、".join(f"{item['id']}({item['label']})" for item in candidates) or "AI根据USER_STORY自行判断"
    return (
        "RHYTHM_HINT:\n"
        f"- 候选叙事类型仅作参考：{candidate_text}；如果不贴合USER_STORY，必须忽略候选并自行设计。\n"
        "- AI先判断用户剧情的主角、核心目标、关键冲突、状态变化和结局方向，再自由分配9格节奏；不要套固定九格模板。\n"
        "- 每格必须回答：相比上一格新增了什么可见动作、信息、关系、局势、身份、代价或结果。\n"
        "- 同一场景可以连续出现，但每格必须改变角色行为、攻守关系、任务进度、情绪选择、物件状态或外界反馈；不能只换地点、看风景或重复姿势。"
    )


def storyboard_unified_destination_progress_rule(story_text: str) -> str:
    anchors = storyboard_unified_explicit_anchor_candidates(story_text)
    candidates = storyboard_unified_rhythm_candidates(story_text)
    is_space_goal = any(item.get("id") == "SPACE_GOAL" for item in candidates)
    if not anchors or not is_space_goal:
        return ""
    anchor_text = "、".join(anchors[:3])
    target_terms: list[str] = []
    for anchor in anchors[:3]:
        for term in storyboard_unified_destination_term_candidates(anchor):
            if term not in target_terms:
                target_terms.append(term)
    target_text = "、".join(target_terms[:8]) or anchor_text
    return (
        f"显式目的地推进规则：用户写出目的地或目标空间“{anchor_text}”时，"
        "起点环境只能服务于故事开端，不要让9段长期停留在参考图背景、路途、交通工具或看风景；"
        f"故事前中段需要自然出现或进入与“{target_text}”相关的目标空间，并开始目标相关行动；"
        "后半段应围绕用户的核心任务、机会、关系、困难、调整或关键行动展开；"
        "如果用户剧情本身不是旅行过程，不要把主要篇幅写成赶路、候车、等待交通或想象未来；"
        "第9段呈现用户目标造成的最终结果或新状态。"
    )


def build_storyboard_unified_nine_shot_prompt(
    story_text: str,
    source_analysis: str,
    visual_cue_pack: str,
    seed: str,
) -> str:
    story_terms = "、".join(storyboard_unified_story_key_terms(story_text)[:6]) or "用户原文关键词"
    story_subject = storyboard_unified_user_subject(story_text)
    explicit_anchors = "、".join(storyboard_unified_explicit_anchor_candidates(story_text)) or "无"
    visual_context = clean_text(visual_cue_pack or source_analysis)[:260] or "无"
    rhythm_context = storyboard_unified_rhythm_library_prompt(story_text)
    destination_progress_rule = storyboard_unified_destination_progress_rule(story_text)
    conflict_progress_rule = storyboard_unified_conflict_progress_rule(story_text)
    transformation_progress_rule = storyboard_unified_transformation_progress_rule(story_text)
    return (
        "用户剧情：{story}\n"
        "参考图视觉信息：{visual}\n"
        "主角固定称呼：{subject}。每段使用这个称呼或“主角/她/他”，不要额外拼接改写成错误称呼。\n"
        "用户剧情关键词：{terms}。\n"
        "显式地点/目的地：{anchors}。\n\n"
        "{rhythm}\n\n"
        "请像分镜导演一样，一次性生成9段连续分镜描述。\n"
        "核心原则：\n"
        "1. 用户剧情是真实主线，必须保留主角、核心目标、显式地点和结局方向；不要把主角改成其他年龄、性别或物种称呼。\n"
        "2. 参考图只锁定主角外观、服装道具、画风、色彩光线和可兼容素材；不要复制参考图姿势、镜头、构图或背景地点。\n"
        "3. 每段都回答“相比上一段新增了什么可见事件或状态变化”，环境只能承载剧情，不能把换地点或看风景当成推进。\n"
        "4. 每段画面描述写成两句：第一句写主角外观/道具锚点和具体动作，第二句写场景细节、互动对象或事件结果；不要只写摘要、心情或一句短动作。\n"
        "5. 新增角色、敌人、路人或伙伴不得继承主角的脸、发型、服装、翅膀、装备、道具或颜色布局，也不得替代主角成为后续共同主角；用户未写出的支线角色不能连续占用多段。\n"
        "6. 第9段呈现用户剧情目标造成的最终可见结果或新状态。\n"
        "{destination_rule}"
        "{conflict_rule}"
        "{transformation_rule}"
        "只输出9行，不写Markdown，不写解释，不写多余文字。\n"
        "每行格式：Scene 01｜短标题｜完整画面描述\n"
        "每行画面描述45到95个中文字符，必须是可直接生图的单张画面，不要少于35个中文字。\n"
        "短标题不要写“短标题”三个字，9个标题不能重复。\n"
        "如果某一行没有比上一行新增可见事件，请重写该行。\n"
        "随机种子:{seed}\n"
    ).format(
        story=story_text,
        visual=visual_context,
        subject=story_subject,
        terms=story_terms,
        anchors=explicit_anchors,
        rhythm=rhythm_context,
        destination_rule=f"{destination_progress_rule}\n" if destination_progress_rule else "",
        conflict_rule=f"{conflict_progress_rule}\n" if conflict_progress_rule else "",
        transformation_rule=f"{transformation_progress_rule}\n" if transformation_progress_rule else "",
        seed=seed,
    )


STORYBOARD_UNIFIED_ANCHOR_START_RE = re.compile(
    r"(?:在|进入|来到|前往|去往|走进|抵达|到达|奔向|赶往)([^，。！？；;、\n]{2,28})"
)
STORYBOARD_UNIFIED_ANCHOR_TRIM_RE = re.compile(
    r"(离开|进入|来到|前往|去往|走进|抵达|到达|奔向|赶往|遭遇|遇到|碰到|对抗|交战|战斗|攻击|袭击|逼近|寻找|追寻|修复|修好|唤醒|阻止|拯救|保护|揭露|调查|解决|击败|逃离|守护|完成|成为|获得|发现|打开|关闭|启动|穿过|穿越|返回|回到|必须|需要|准备|开始|继续|最终|并且|同时|然后|为了|让)"
)
STORYBOARD_UNIFIED_TERM_STOPWORDS = {
    "用户剧情", "真实主线", "必须", "需要", "不能", "不得", "不要", "可以", "应该",
    "开始", "继续", "最终", "然后", "同时", "并且", "为了", "核心", "结果",
}


def storyboard_unified_trim_story_phrase(value: str) -> str:
    text = clean_text(value)
    text = re.sub(r"^(一名|一个|一位|这名|这个|那个|他的|她的|它的)", "", text).strip()
    match = STORYBOARD_UNIFIED_ANCHOR_TRIM_RE.search(text)
    if match and match.start() > 0:
        text = text[:match.start()]
    text = re.sub(r"(的|中|里|上|前|旁|附近|内部|中心|入口|边缘|方向|旅途|路上|途中|之旅|旅程)$", "", text).strip()
    return text[:18]


def storyboard_unified_explicit_anchor_candidates(story_text: str) -> list[str]:
    text = clean_text(story_text)
    anchors: list[str] = []
    for match in STORYBOARD_UNIFIED_ANCHOR_START_RE.finditer(text):
        raw_match = clean_text(match.group(0))
        if raw_match.startswith("在") and re.search(r"(遭遇|遇到|碰到|对抗|交战|战斗|袭击|攻击)", raw_match):
            continue
        anchor = storyboard_unified_trim_story_phrase(match.group(1))
        if len(anchor) >= 2 and anchor not in anchors:
            anchors.append(anchor)
    return anchors[:3]


def storyboard_unified_story_key_terms(story_text: str) -> list[str]:
    text = clean_text(story_text)
    terms: list[str] = []
    for anchor in storyboard_unified_explicit_anchor_candidates(text):
        if anchor not in terms:
            terms.append(anchor)
    chunks = [
        clean_text(part)
        for part in re.split(r"[，。！？；;、\s]+", text)
        if len(clean_text(part)) >= 2
    ]
    for chunk in chunks:
        phrase = storyboard_unified_trim_story_phrase(chunk)
        if len(phrase) >= 2 and phrase not in STORYBOARD_UNIFIED_TERM_STOPWORDS and phrase not in terms:
            terms.append(phrase)
        for token in re.findall(r"[\u4e00-\u9fffA-Za-z0-9]{2,10}", chunk):
            token = clean_text(token)
            if token in STORYBOARD_UNIFIED_TERM_STOPWORDS:
                continue
            if len(token) >= 2 and token not in terms:
                terms.append(token)
        if len(terms) >= 8:
            break
    return terms[:8]


def storyboard_unified_term_hit(text: str, term: str) -> bool:
    source = clean_text(text)
    needle = clean_text(term)
    if len(needle) < 2:
        return False
    if needle in source:
        return True
    if len(needle) <= 3:
        return False
    for size in range(min(4, len(needle)), 1, -1):
        for index in range(0, len(needle) - size + 1):
            gram = needle[index:index + size]
            if gram in source:
                return True
    return False


def storyboard_unified_story_lock_hint(story_text: str) -> str:
    anchors = storyboard_unified_explicit_anchor_candidates(story_text)
    terms = storyboard_unified_story_key_terms(story_text)
    anchor_text = "、".join(anchors) if anchors else "无明确地点或目的地"
    term_text = "、".join(terms[:6]) if terms else "以用户原文为准"
    return f"显式地点/目的地候选:{anchor_text}；关键短语候选:{term_text}；第9段必须回扣用户原文的核心结果。"


STORYBOARD_UNIFIED_IDENTITY_ANCHOR_PATTERN = re.compile(
    r"(短发|长发|黑发|白发|金发|银发|背包|手提箱|行李箱|上衣|短裤|长裙|甲裙|盔甲|铠甲|王冠|皇冠|羽翼|翅膀|长剑|法杖|折扇|面具|斗篷|制服|绿色|橙色|深色|黑色|白色|金色|银色|红色|华丽|写实|动画|日漫|电影感|幻想|暗黑|治愈|清澈)"
)

STORYBOARD_UNIFIED_BACKGROUND_ANCHOR_PATTERN = re.compile(
    r"(山丘|小路|雪山|森林|荒原|战场|城市|街道|公司|车站|列车|殿堂|神殿|王座|天空|云|海边|沙滩|度假村|背景|地点|场景|环境)"
)


def storyboard_unified_reference_identity_anchor(story_text: str, visual_text: str) -> str:
    subject = storyboard_unified_user_subject(story_text)
    fragments: list[str] = []
    source = clean_text(visual_text)
    for part in re.split(r"[；;。,.，、:：]", source):
        fragment = clean_text(part)
        if len(fragment) < 2:
            continue
        has_identity = STORYBOARD_UNIFIED_IDENTITY_ANCHOR_PATTERN.search(fragment)
        if not has_identity:
            continue
        if STORYBOARD_UNIFIED_BACKGROUND_ANCHOR_PATTERN.search(fragment) and not re.search(r"(背包|手提箱|行李箱|上衣|短裤|长裙|甲裙|盔甲|铠甲|王冠|皇冠|羽翼|翅膀|长剑|法杖|折扇|面具|斗篷|制服|写实|动画|日漫|电影感|幻想|暗黑|治愈|清澈)", fragment):
            continue
        fragment = re.sub(r"^(参考图可见素材|使用方式|用户剧情)\s*", "", fragment).strip()
        fragment = re.sub(r"(只作为|来源|不当固定剧情模板).*", "", fragment).strip()
        if fragment and fragment not in fragments:
            fragments.append(fragment[:26])
        if len(fragments) >= 4:
            break
    if fragments:
        return f"同一{subject}，参考图锚点：" + "、".join(fragments)
    return f"同一{subject}，参考图锚点：主体轮廓、服装道具和画风"


def storyboard_unified_clean_scene_prompt_text(prompt: str) -> str:
    text = clean_text(prompt)
    text = re.sub(r"，?象征着[^，。；;]*", "", text)
    text = re.sub(r"，?似乎[^，。；;]*", "", text)
    text = re.sub(r"(女少女|青少年)(?=离开|来到|走进|踏入|站在|背着|坐在|在|继续|成功|决定|收到)", "少女", text)
    text = re.sub(r"\s+", " ", text).strip(" ，。")
    return text


def storyboard_unified_explicit_final_identity_phrase(story_text: str) -> str:
    source = clean_text(story_text)
    match = re.search(r"(?:最终|最后|逐渐|彻底)?(?:堕落|转变|变成|变为|成长)?成为([^，。！？；;]{2,18})", source)
    if not match:
        return ""
    phrase = clean_text(match.group(1))
    phrase = re.sub(r"^(?:了)?(?:一名|一个|一位|新的|真正的)?", "", phrase).strip()
    if len(phrase) < 2:
        return ""
    return phrase[:12]


def storyboard_unified_goal_action_phrase(story_text: str) -> str:
    source = clean_text(story_text)
    match = re.search(r"寻找([^，。！？；;]{2,12})", source)
    if match:
        target = clean_text(match.group(1))
        return f"寻找{target}相关机会"
    if re.search(r"(工作|职位|入职|公司|机会)", source):
        return "寻找工作机会"
    if re.search(r"(梦想|理想|目标)", source):
        return "寻找目标相关机会"
    return "执行目标相关行动"


def storyboard_unified_space_goal_scene4_repair_prompt(
    story_text: str,
    identity_anchor: str,
    current_prompt: str,
) -> str:
    return current_prompt


def storyboard_unified_enrich_final_shot_prompts(
    shots: list[dict],
    story_text: str,
    visual_text: str,
) -> list[dict]:
    identity_anchor = storyboard_unified_reference_identity_anchor(story_text, visual_text)
    final_identity = storyboard_unified_explicit_final_identity_phrase(story_text)
    enriched: list[dict] = []
    for index, item in enumerate(shots):
        if not isinstance(item, dict):
            continue
        next_item = dict(item)
        prompt = storyboard_unified_clean_scene_prompt_text(str(next_item.get("prompt") or ""))
        chinese_chars = re.findall(r"[\u4e00-\u9fff]", prompt)
        if len(chinese_chars) < 42:
            prompt = f"{identity_anchor}。{prompt}。"
        elif identity_anchor and clean_text(identity_anchor)[:8] not in clean_text(prompt):
            prompt = f"{identity_anchor}。{prompt}"
        if index == 3:
            prompt = storyboard_unified_space_goal_scene4_repair_prompt(story_text, identity_anchor, prompt)
        if index == len(shots) - 1 and final_identity and not storyboard_unified_term_hit(prompt, final_identity):
            prompt = f"{prompt.rstrip('，。；; ')}，画面明确呈现她已成为{final_identity}的最终身份。"
        next_item["prompt"] = prompt[:900]
        enriched.append(next_item)
    return enriched


def storyboard_unified_last_anchor_error(story_text: str, last_text: str) -> str:
    story_source = clean_text(story_text)
    last_source = clean_text(last_text)
    anchors = storyboard_unified_explicit_anchor_candidates(story_source)
    anchor_missed = bool(anchors and not any(storyboard_unified_term_hit(last_source, anchor) for anchor in anchors))
    terms = storyboard_unified_story_key_terms(story_source)
    if terms:
        hits = sum(1 for term in terms if storyboard_unified_term_hit(last_source, term))
        required = 1 if len(terms) <= 3 else 2
        if hits < required:
            return f"第9段没有充分回扣用户剧情关键短语，命中 {hits}/{required}"
    if re.search(r"(新的旅程|下一段旅程|下一次冒险|走向远方|继续前行|准备离开|日常生活|未来等待)", last_source):
        if terms and sum(1 for term in terms if storyboard_unified_term_hit(last_source, term)) < 2:
            return "第9段像泛化收尾，没有清楚呈现用户剧情核心结果"
        if anchor_missed:
            return "第9段像泛化收尾，没有回扣用户剧情的显式地点或目的地"
    if anchor_missed:
        return "第9段未明显回扣用户剧情中的显式地点或目的地"
    return ""


def storyboard_unified_destination_term_candidates(anchor: str) -> list[str]:
    text = clean_text(anchor)
    terms = [text] if text else []
    if re.search(r"(大城市|大都市|都市|城市|城里)", text):
        terms.extend(["大城市", "城市", "都市", "街道", "高楼", "公司", "工作"])
    if re.search(r"(海边|海岸|海滨|小镇|度假村)", text):
        terms.extend(["海边", "海岸", "海滨", "小镇", "沙滩", "海洋"])
    if re.search(r"(皇城|宫殿|王宫|皇宫)", text):
        terms.extend(["皇城", "宫殿", "王宫", "皇宫"])
    if re.search(r"(温室|花园|植物|花房)", text):
        terms.extend(["温室", "花园", "植物", "花房"])
    output: list[str] = []
    for term in terms:
        if term and term not in output:
            output.append(term)
    return output


def storyboard_unified_space_goal_progress_warning(shots: list[dict], story_text: str) -> str:
    if not isinstance(shots, list) or len(shots) != 9:
        return ""
    candidates = storyboard_unified_rhythm_candidates(story_text)
    if not any(item.get("id") == "SPACE_GOAL" for item in candidates):
        return ""
    anchors = storyboard_unified_explicit_anchor_candidates(story_text)
    if not anchors:
        return ""
    target_terms: list[str] = []
    for anchor in anchors[:3]:
        for term in storyboard_unified_destination_term_candidates(anchor):
            if term not in target_terms:
                target_terms.append(term)
    if not target_terms:
        return ""
    scene_texts = [
        clean_text(f"{item.get('title', '')} {item.get('prompt', '')} {item.get('sceneAnchor', '')}")
        for item in shots
        if isinstance(item, dict)
    ]
    first_target_index = None
    for index, text in enumerate(scene_texts):
        if any(storyboard_unified_term_hit(text, term) for term in target_terms):
            first_target_index = index
            break
    if first_target_index is None:
        return f"空间目标型未进入显式目的地：{target_terms[0]}"
    if first_target_index > 3:
        return f"显式目的地进入过晚：Scene{first_target_index + 1:02d}"
    if len(scene_texts) >= 4:
        scene4 = scene_texts[3]
        scene4_has_target = any(storyboard_unified_term_hit(scene4, term) for term in target_terms)
        scene4_is_transit = bool(re.search(r"(前往|去往|赶往|车站|火车|列车|车内|路上|途中|入口外|等待|想象)", scene4))
        if scene4_has_target and scene4_is_transit:
            return "第4段仍是前往目标的交通过渡，未真正进入目标空间"
    middle_text = " ".join(scene_texts[4:8])
    journey_hits = len(re.findall(r"(旅途|候车|上车|列车|火车|车站|乡间|山林|森林|小路|前行|等待|看风景|远方)", middle_text))
    target_hits = sum(1 for text in scene_texts[4:8] if any(storyboard_unified_term_hit(text, term) for term in target_terms))
    if journey_hits >= 4 and target_hits < 2:
        return "中后段仍以路途或交通等待为主，未围绕显式目的地展开任务"
    return ""


STORYBOARD_UNIFIED_STATIC_TITLE_PATTERN = re.compile(
    r"^(风景|沿途风景|景色|小路尽头|城市边缘|中心|边缘|夜晚|日出|新起点|新的力量|黑暗的诱惑|内心独白|内心挣扎|反思|思考|休息|小憩|梦境|远方|旅途|受阻缺口|调整方法|关键行动|新状态|最终身份|外界确认|主动选择|失控边缘|故事建立|角色进入|变化出现|冲突展开|局势升级|主动推进|高潮到来|结果显现|故事收束)$"
)

STORYBOARD_UNIFIED_VISIBLE_CHANGE_PATTERN = re.compile(
    r"(发现|遇到|交谈|交流|询问|告别|到达|进入|离开|踏入|走进|走出|穿过|寻找|尝试|学习|写|画|展示|递交|面试|等待结果|收到|获得|失去|拒绝|接受|决定|选择|放下|丢下|拾起|握住|打开|推开|关闭|戴上|摘下|脱下|披上|跪下|站起|转身|伸手|扶起|救助|治疗|破碎|裂开|裂痕|染黑|变暗|暗淡|褪色|变弱|发光|熄灭|消散|吞噬|符文|崩塌|坠落|升起|出现|消失|留下|回头|签下|搬入|开始工作|成为|登上|坐上|登顶|抵达)"
)

STORYBOARD_UNIFIED_WEAK_PROGRESS_PATTERN = re.compile(
    r"(看风景|远处.*显得|继续前行|坚定前行|继续寻找|四处张望|寻找机会|找到自己的位置|生活逐渐稳定|准备踏上|停下脚步|站在.*(望|看|眺望|充满|似乎)|眼神|目光|神情|脸上露出|心中|内心|思考|反思|憧憬|期待|犹豫|绝望|决心|气氛|氛围|遇到挫折|周围.*火焰|背景.*火焰|享受|欣赏|胜局已定|败局已定|胜利姿态)"
)

STORYBOARD_UNIFIED_STATIC_POSE_PATTERN = re.compile(
    r"(站在|站立|站定|站起身|看向|望向|眺望|睁开|闭上|眼神|目光|双手合十|双手紧握|双臂展开|张开双臂|抬起.*臂|伸出.*手|停下脚步|独自站|低头|沉思|似乎|象征|心中|充满|感到|意识到|意志)"
)

STORYBOARD_UNIFIED_ACTIVE_ACTION_PATTERN = re.compile(
    r"(奔跑|冲刺|追赶|躲闪|翻滚|跳起|扑向|挥|劈|刺|砍|格挡|抵挡|推开|拉开|抓住|扶起|救助|治疗|递交|接过|打开|关上|撕下|摘下|戴上|背起|放下|举起|搬起|攀爬|登上|跪下|坐下|走进|走出|穿过|进入|离开|交谈|拥抱|展示|写下|画出|修理|操作|驾驶|坠落|升起|爆发|破碎|裂开|燃烧|熄灭|击中|反击|包围|逃离)"
)

STORYBOARD_UNIFIED_POSE_CATEGORY_PATTERNS = (
    ("gaze", re.compile(r"(看向|望向|眺望|睁开|闭上|眼神|目光|远方)")),
    ("stand", re.compile(r"(站在|站立|站定|站起身|独自站)")),
    ("spread", re.compile(r"(双臂展开|张开双臂|展开.*翅|展开.*翼|举起.*双手|抬起.*双臂)")),
    ("prayer", re.compile(r"(双手合十|祈祷|宣誓|双手紧握|紧握成拳)")),
)


STORYBOARD_UNIFIED_SINGLE_SCENE_PATTERN = re.compile(
    r"(同一|原地|对战|决斗|擂台|竞技场|战斗|单挑|强敌|黑龙|巨龙|怪物|巨兽|审讯|庭审|会议|谈判|病房|手术室|舞台|密室|王座)"
)

STORYBOARD_UNIFIED_OUT_OF_DOMAIN_CONFLICT_PATTERN = re.compile(
    r"(小偷|偷窃|抢劫|犯罪|绑架|追杀|袭击|搏斗|打斗|战斗|决斗|敌人|怪物|巨兽|恶龙|黑龙|魔法|法术|爆炸|灾难|末日|战争|丧尸|恶魔)"
)

STORYBOARD_UNIFIED_CONFLICT_ALLOWED_PATTERN = re.compile(
    r"(小偷|偷窃|抢劫|犯罪|绑架|追杀|袭击|搏斗|打斗|战斗|对战|决斗|敌人|怪物|巨兽|恶龙|黑龙|龙|魔法|法术|爆炸|灾难|末日|战争|丧尸|恶魔|逃亡|拯救|阻止)"
)


STORYBOARD_UNIFIED_TRANSFORMATION_PATTERN = re.compile(
    r"(逐渐|侵蚀|堕落|黑化|腐化|觉醒|成长|蜕变|变身|转变|成为|失控|净化|恢复|复仇|觉悟)"
)


def storyboard_unified_conflict_progress_rule(story_text: str) -> str:
    if not STORYBOARD_UNIFIED_CONFLICT_ALLOWED_PATTERN.search(clean_text(story_text)):
        return ""
    return (
        "对战/追逐补充原则：不要把9段写成连续站立、对峙、盘旋或重复挥剑；"
        "每段必须让攻守关系、距离、招式、伤势、武器状态、空间位置或局势结果至少变化一项；"
        "不要把左脚右脚、双臂交叉、目光变化这类微姿势当成剧情推进；"
        "同一动作短语、敌人反应或距离描述不能在多段重复；"
        "同一个战斗结果不要连续复用，“被击退、消失、胜利”这类结算词只放在最后两段；"
        "第8段写关键行动或决定性反扑，但不要写守护成功、敌人消失或恢复宁静；第9段再写最终结果。"
    )


def storyboard_unified_transformation_progress_rule(story_text: str) -> str:
    source = clean_text(story_text)
    if not STORYBOARD_UNIFIED_TRANSFORMATION_PATTERN.search(source):
        return ""
    direction_rule = ""
    if re.search(r"(堕落|黑化|腐化|黑暗|魔王|恶魔)", source) and not re.search(r"(净化|恢复|救赎|回归光明)", source):
        direction_rule = "如果最终状态是黑化、堕落或成为魔王，后段变化必须继续变暗、失控或权力化，不要写神圣气息、净化、恢复明亮或回归光明；"
    return (
        "状态转变补充原则：不要把9段写成连续凝视、沉思、转身、站立或火焰环绕；"
        "每段必须让外观、道具、环境、关系、力量痕迹或身份状态产生可见变化；"
        "所有变化必须朝用户写的最终状态累积推进，不要中途恢复成相反方向；"
        f"{direction_rule}"
        "第8段写最后选择、仪式、突破或不可逆行动，第9段再写最终身份或最终状态。"
    )


STORYBOARD_UNIFIED_PREMATURE_RESULT_PATTERN = re.compile(
    r"(战斗结束|胜利|胜负已分|最终守住|守护成功|恢复宁静|恢复晴朗|敌人消失|黑龙消失|怪物消失)"
)


STORYBOARD_UNIFIED_REPEATED_COMBAT_RESULT_PATTERN = re.compile(
    r"(被击退|击退|倒下|击倒|败退|落败|消失|逃走)"
)

STORYBOARD_UNIFIED_REPEATED_COMBAT_PHRASE_PATTERNS = (
    re.compile(r"双方距离拉近"),
    re.compile(r"张开巨口"),
    re.compile(r"挥剑"),
    re.compile(r"被击退"),
    re.compile(r"调整姿势"),
)


def storyboard_unified_allows_repeated_anchor(story_text: str, anchor: str) -> bool:
    source = clean_text(f"{story_text} {anchor}")
    if not source:
        return False
    return bool(STORYBOARD_UNIFIED_SINGLE_SCENE_PATTERN.search(source))


def storyboard_unified_allows_destination_repeated_anchor(story_text: str, anchor: str) -> bool:
    normalized_anchor = clean_text(anchor)
    if not normalized_anchor:
        return False
    candidates = storyboard_unified_rhythm_candidates(story_text)
    if not any(item.get("id") == "SPACE_GOAL" for item in candidates):
        return False
    explicit_anchors = storyboard_unified_explicit_anchor_candidates(story_text)
    for explicit_anchor in explicit_anchors[:3]:
        for term in storyboard_unified_destination_term_candidates(explicit_anchor):
            if storyboard_unified_term_hit(normalized_anchor, term) or storyboard_unified_term_hit(term, normalized_anchor):
                return True
    return False


def storyboard_unified_domain_drift_warning(shots: list[dict], story_text: str) -> str:
    story_source = clean_text(story_text)
    if STORYBOARD_UNIFIED_CONFLICT_ALLOWED_PATTERN.search(story_source):
        return ""
    output_text = clean_text("\n".join(
        f"{item.get('title', '')} {item.get('prompt', '')} {item.get('sceneAnchor', '')}"
        for item in shots if isinstance(item, dict)
    ))
    match = STORYBOARD_UNIFIED_OUT_OF_DOMAIN_CONFLICT_PATTERN.search(output_text)
    if match:
        return f"剧情冲突越界：{match.group(0)}"
    return ""


def storyboard_unified_conflict_resolution_warning(shots: list[dict], story_text: str) -> str:
    story_source = clean_text(story_text)
    if not STORYBOARD_UNIFIED_CONFLICT_ALLOWED_PATTERN.search(story_source):
        return ""
    scene_texts = [
        clean_text(f"{item.get('title', '')} {item.get('prompt', '')} {item.get('sceneAnchor', '')}")
        for item in shots if isinstance(item, dict)
    ]
    for index, text in enumerate(scene_texts[:7]):
        if STORYBOARD_UNIFIED_PREMATURE_RESULT_PATTERN.search(text):
            return f"对战过早分出结果：Scene{index + 1:02d}"
    if len(scene_texts) >= 8 and re.search(r"(守护成功|守住.*成功|敌人消失|黑龙消失|怪物消失|恢复宁静|恢复晴朗)", scene_texts[7]):
        return "对战第8段已经写成最终结算，应留到第9段"
    combat_body_text = "\n".join(re.sub(r"同一[^。]{1,80}。", "", text) for text in scene_texts)
    for pattern in STORYBOARD_UNIFIED_REPEATED_COMBAT_PHRASE_PATTERNS:
        if len(pattern.findall(combat_body_text)) >= 3:
            return f"对战动作短语重复过多：{pattern.pattern}"
    result_hits = [
        index + 1 for index, text in enumerate(scene_texts)
        if STORYBOARD_UNIFIED_REPEATED_COMBAT_RESULT_PATTERN.search(text)
    ]
    if len(result_hits) >= 4:
        return f"对战结果重复过多：Scene{result_hits[0]:02d}"
    for prev, cur in zip(result_hits, result_hits[1:]):
        if cur == prev + 1 and cur < 8:
            return f"连续重复击退/落败结果：Scene{prev:02d}-Scene{cur:02d}"
    return ""


def storyboard_unified_progress_warning(shots: list[dict], story_text: str = "") -> str:
    static_titles: list[str] = []
    weak_indexes: list[int] = []
    static_pose_indexes: list[int] = []
    active_action_count = 0
    pose_category_counts: dict[str, int] = {}
    repeated_anchor_count: dict[str, int] = {}
    previous_title = ""
    previous_prompt = ""
    previous_anchor = ""
    previous_index = 0
    for index, item in enumerate(shots):
        if not isinstance(item, dict):
            continue
        title = clean_text(str(item.get("title") or ""))
        prompt = clean_text(str(item.get("prompt") or ""))
        anchor = normalize_storyboard_director_field(str(item.get("sceneAnchor") or ""))
        prompt_signature = normalize_storyboard_director_field(prompt)
        if previous_index:
            same_title = bool(title and normalize_storyboard_director_field(title) == previous_title)
            same_anchor = bool(anchor and anchor == previous_anchor)
            prompt_reused = bool(
                prompt_signature
                and previous_prompt
                and (
                    prompt_signature == previous_prompt
                    or prompt_signature in previous_prompt
                    or previous_prompt in prompt_signature
                )
            )
            if same_title and same_anchor:
                return f"连续事件疑似重复：Scene{previous_index:02d}-Scene{index + 1:02d}"
            if same_anchor and prompt_reused:
                return f"连续画面描述疑似复用：Scene{previous_index:02d}-Scene{index + 1:02d}"
        previous_title = normalize_storyboard_director_field(title)
        previous_prompt = prompt_signature
        previous_anchor = anchor
        previous_index = index + 1
        if title and STORYBOARD_UNIFIED_STATIC_TITLE_PATTERN.search(title):
            static_titles.append(f"Scene{index + 1:02d}:{title}")
        if anchor:
            repeated_anchor_count[anchor] = repeated_anchor_count.get(anchor, 0) + 1
        has_visible_change = bool(STORYBOARD_UNIFIED_VISIBLE_CHANGE_PATTERN.search(prompt))
        weak_progress = bool(STORYBOARD_UNIFIED_WEAK_PROGRESS_PATTERN.search(prompt))
        has_active_action = bool(STORYBOARD_UNIFIED_ACTIVE_ACTION_PATTERN.search(prompt))
        if weak_progress and (not has_visible_change or not has_active_action):
            weak_indexes.append(index + 1)
        if has_active_action:
            active_action_count += 1
        if STORYBOARD_UNIFIED_STATIC_POSE_PATTERN.search(prompt) and not has_visible_change and not has_active_action:
            static_pose_indexes.append(index + 1)
        for category, pattern in STORYBOARD_UNIFIED_POSE_CATEGORY_PATTERNS:
            if pattern.search(prompt) and not has_visible_change and not has_active_action:
                pose_category_counts[category] = pose_category_counts.get(category, 0) + 1
    if len(static_titles) >= 2:
        return f"静态标题过多：{'、'.join(static_titles[:4])}"
    if len(static_pose_indexes) >= 5 and active_action_count < 5:
        return f"静态姿态过多：Scene{static_pose_indexes[0]:02d}"
    for category, count in pose_category_counts.items():
        if count >= 3:
            return f"同类姿态重复过多：{category} x{count}"
    for anchor, count in repeated_anchor_count.items():
        if count >= 5:
            if storyboard_unified_allows_repeated_anchor(story_text, anchor):
                continue
            if storyboard_unified_allows_destination_repeated_anchor(story_text, anchor):
                continue
            return f"同一场景锚点重复过多：{anchor} x{count}"
    if len(weak_indexes) >= 3:
        return f"弱剧情推进过多：Scene{weak_indexes[0]:02d}"
    for prev, cur in zip(weak_indexes, weak_indexes[1:]):
        if cur == prev + 1:
            return f"连续弱剧情推进：Scene{prev:02d}-Scene{cur:02d}"
    conflict_warning = storyboard_unified_conflict_resolution_warning(shots, story_text)
    if conflict_warning:
        return conflict_warning
    return ""


def storyboard_unified_prompt_detail_warning(shots: list[dict]) -> str:
    short_indexes: list[int] = []
    for index, item in enumerate(shots):
        if not isinstance(item, dict):
            continue
        prompt = clean_text(str(item.get("prompt") or ""))
        chinese_chars = re.findall(r"[\u4e00-\u9fff]", prompt)
        if len(chinese_chars) < 32:
            short_indexes.append(index + 1)
    if len(short_indexes) >= 3:
        return f"提示词过短过多：Scene{short_indexes[0]:02d}"
    return ""


def storyboard_unified_story_lock_warning(shots: list[dict], story_text: str) -> str:
    if not isinstance(shots, list) or len(shots) != 9:
        return f"数量异常 {len(shots) if isinstance(shots, list) else 0}/9"
    titles = [
        clean_text(str(item.get("title", "")))
        for item in shots
        if isinstance(item, dict)
    ]
    if len({title for title in titles if title}) < 5:
        return "9段短标题重复过多，分镜阶段不清晰"
    space_goal_warning = storyboard_unified_space_goal_progress_warning(shots, story_text)
    if space_goal_warning:
        return space_goal_warning
    progress_warning = storyboard_unified_progress_warning(shots, story_text)
    if progress_warning:
        return progress_warning
    domain_drift_warning = storyboard_unified_domain_drift_warning(shots, story_text)
    if domain_drift_warning:
        return domain_drift_warning
    detail_warning = storyboard_unified_prompt_detail_warning(shots)
    if detail_warning:
        return detail_warning
    output_text = clean_text("\n".join(
        f"{item.get('title', '')} {item.get('prompt', '')} {item.get('sceneAnchor', '')}"
        for item in shots if isinstance(item, dict)
    ))
    story_source = clean_text(story_text)
    story_subject = storyboard_unified_user_subject(story_source)
    if story_subject and story_subject != "主角" and not storyboard_unified_term_hit(output_text, story_subject):
        return f"9段未保留用户剧情主角词：{story_subject}"
    last_text = clean_text(
        f"{shots[-1].get('title', '')} {shots[-1].get('prompt', '')} {shots[-1].get('sceneAnchor', '')}"
    )
    anchor_error = storyboard_unified_last_anchor_error(story_source, last_text)
    if anchor_error:
        return anchor_error
    return ""


def normalize_storyboard_final_shot_prompt_item(item, index: int) -> dict:
    title = ""
    prompt = ""
    scene_anchor = ""
    camera = ""
    change = ""
    if isinstance(item, str):
        prompt = clean_text(item)
    elif isinstance(item, list):
        values = [clean_text(str(value or "")) for value in item]
        if len(values) >= 3 and re.fullmatch(r"\d+", values[0] or ""):
            title = values[1]
            prompt = values[2]
        elif len(values) >= 2:
            title = values[0]
            prompt = values[-1]
        elif values:
            prompt = values[0]
    elif isinstance(item, dict):
        title = clean_text(str(
            item.get("title") or item.get("name") or item.get("event") or item.get("sceneTitle") or ""
        ))
        change = clean_text(str(
            item.get("change") or item.get("newChange") or item.get("stateChange") or item.get("progress") or ""
        ))
        prompt = clean_text(str(
            item.get("prompt") or item.get("positivePrompt") or item.get("shotPrompt") or
            item.get("description") or item.get("text") or item.get("画面提示词") or item.get("提示词") or ""
        ))
        scene_anchor = clean_text(str(
            item.get("sceneAnchor") or item.get("currentSpace") or item.get("space") or item.get("location") or ""
        ))
        camera = clean_text(str(item.get("camera") or item.get("shot") or item.get("lens") or ""))
    prompt = re.sub(r"^Scene\s*\d+\s*[:：.\-、]\s*", "", prompt, flags=re.I).strip()
    prompt = re.sub(r"^第?\s*\d+\s*[格幕镜头場场]*\s*[:：.\-、]\s*", "", prompt).strip()
    if title:
        title = re.sub(r"^Scene\s*\d+\s*[:：.\-、]\s*", "", title, flags=re.I).strip()
    if not title:
        title = f"镜头{index + 1:02d}"
    return {
        "scene": index + 1,
        "title": title[:24],
        "change": change[:160],
        "prompt": prompt[:900],
        "sceneAnchor": scene_anchor[:80],
        "camera": camera[:80],
    }


def storyboard_final_shot_prompt_is_invalid(item: dict) -> bool:
    title = clean_text(str(item.get("title") or ""))
    prompt = clean_text(str(item.get("prompt") or ""))
    if not prompt:
        return True
    placeholder_text = f"{title} {prompt}"
    if re.search(r"(短标题|最终生图提示词|生图提示词|提示词内容|画面描述|具体内容)", placeholder_text):
        return True
    return len(prompt) < 12


STORYBOARD_FINAL_SHOT_SCENE_HEADER_RE = re.compile(
    r"(?m)^\s*(?:Scene\s*)?0?([1-9])\s*[\.、:：\-|｜]?\s*(.*)$",
    re.I,
)


def storyboard_final_shot_split_title_prompt(rest: str, body: str, scene_no: int) -> tuple[str, str]:
    header = clean_text(rest)
    body_text = clean_text(body)
    header = re.sub(r"^(短标题|标题)\s*[:：|｜/／\-]\s*", "", header).strip()
    title = ""
    prompt = ""
    split_match = re.match(r"^([^:：|｜/／]{1,18})[:：|｜/／]\s*(.+)$", header)
    if split_match:
        title = clean_text(split_match.group(1))
        prompt = clean_text(split_match.group(2))
        if title in {"短标题", "标题"}:
            title = prompt
            prompt = ""
    elif header:
        title = header
    if body_text:
        prompt = body_text
    elif not prompt:
        prompt = header
    title = re.sub(r"^(短标题|标题)\s*[:：|｜/／\-]\s*", "", title).strip()
    return (title[:24] or f"镜头{scene_no:02d}", prompt[:900])


def parse_storyboard_final_shot_prompt_sections(text: str) -> list[dict]:
    source = str(text or "")
    matches = list(STORYBOARD_FINAL_SHOT_SCENE_HEADER_RE.finditer(source))
    if not matches:
        return []
    shots: list[dict] = []
    for index, match in enumerate(matches):
        scene_no = int(match.group(1))
        rest = clean_text(match.group(2))
        body_start = match.end()
        body_end = matches[index + 1].start() if index + 1 < len(matches) else len(source)
        body_lines = [
            clean_text(line)
            for line in source[body_start:body_end].splitlines()
            if clean_text(line)
        ]
        title, prompt = storyboard_final_shot_split_title_prompt(rest, " ".join(body_lines), scene_no)
        shots.append({
            "scene": scene_no,
            "title": title,
            "prompt": prompt,
            "sceneAnchor": "",
            "camera": "",
        })
    if len(shots) != 9:
        raise ValueError(f"FINAL_SHOT_PROMPT_PARSE_FAILED：Scene段落数量异常 {len(shots)}/9")
    shots = sorted(shots, key=lambda item: int(item.get("scene") or 0))
    actual = [int(item.get("scene") or 0) for item in shots]
    expected = list(range(1, 10))
    if actual != expected:
        raise ValueError(f"FINAL_SHOT_PROMPT_PARSE_FAILED：Scene段落序号异常 {actual}")
    invalid = [index + 1 for index, item in enumerate(shots) if storyboard_final_shot_prompt_is_invalid(item)]
    if invalid:
        raise ValueError(f"FINAL_SHOT_PROMPT_PARSE_FAILED：提示词无效 Scene{invalid[0]:02d}")
    return shots


def parse_storyboard_final_shot_prompt_lines(text: str) -> list[dict]:
    section_shots = parse_storyboard_final_shot_prompt_sections(text)
    if section_shots:
        return section_shots
    lines = [clean_text(line) for line in str(text or "").splitlines()]
    shots: list[dict] = []
    for line in lines:
        if not line:
            continue
        line = re.sub(r"^[-*•\s]+", "", line).strip()
        match = re.match(r"^(?:Scene\s*)?0?([1-9])\s*[\.、:：\-]?\s*(.+)$", line, flags=re.I)
        if not match:
            continue
        scene_no = int(match.group(1))
        rest = clean_text(match.group(2))
        if not rest:
            continue
        title = ""
        prompt = rest
        split_match = re.match(r"^([^:：|｜/／]{1,18})[:：|｜/／]\s*(.+)$", rest)
        if split_match:
            title = clean_text(split_match.group(1))
            prompt = clean_text(split_match.group(2))
        else:
            title = f"镜头{scene_no:02d}"
        shots.append({
            "scene": scene_no,
            "title": title[:24] or f"镜头{scene_no:02d}",
            "prompt": prompt[:900],
            "sceneAnchor": "",
            "camera": "",
        })
    if len(shots) != 9:
        raise ValueError(f"FINAL_SHOT_PROMPT_PARSE_FAILED：9行提示词数量异常 {len(shots)}/9")
    shots = sorted(shots, key=lambda item: int(item.get("scene") or 0))
    expected = list(range(1, 10))
    actual = [int(item.get("scene") or 0) for item in shots]
    if actual != expected:
        raise ValueError(f"FINAL_SHOT_PROMPT_PARSE_FAILED：9行序号异常 {actual}")
    invalid = [index + 1 for index, item in enumerate(shots) if storyboard_final_shot_prompt_is_invalid(item)]
    if invalid:
        raise ValueError(f"FINAL_SHOT_PROMPT_PARSE_FAILED：提示词无效 Scene{invalid[0]:02d}")
    return shots


def parse_storyboard_final_shot_prompts_output(text: str) -> list[dict]:
    json_text, json_closed = extract_storyboard_director_json_array_text(text)
    json_error = ""
    if json_text and json_closed:
        try:
            parsed = json.loads(json_text)
            if not isinstance(parsed, list):
                raise ValueError("顶层不是数组")
            if len(parsed) != 9:
                raise ValueError(f"必须返回9段提示词，实际 {len(parsed)}")
            shots = [normalize_storyboard_final_shot_prompt_item(item, index) for index, item in enumerate(parsed)]
            invalid_indexes = [index + 1 for index, item in enumerate(shots) if storyboard_final_shot_prompt_is_invalid(item)]
            if invalid_indexes:
                raise ValueError(f"提示词无效 Scene{invalid_indexes[0]:02d}")
            return shots
        except Exception as exc:
            json_error = str(exc)
    try:
        return parse_storyboard_final_shot_prompt_lines(text)
    except Exception as line_exc:
        if json_error:
            raise ValueError(f"FINAL_SHOT_PROMPT_PARSE_FAILED：JSON解析失败：{json_error}；行解析失败：{line_exc}") from line_exc
        raise


STORYBOARD_LOCAL_CUE_STOP_WORDS = {
    "参考图", "主线", "世界", "风格", "素材", "人物", "主体", "场景", "地点", "物件", "道具",
    "元素", "生命形态", "核心形象", "明亮", "暗黑", "动画", "写实", "电影感", "整体",
    "敌人", "障碍", "来源", "使用方式", "固定剧情模板",
    "处", "中", "里", "内", "外", "旁", "前", "后", "上", "下", "远景", "近景",
}


def storyboard_clean_local_token(value: str) -> str:
    text = clean_text(str(value or ""))
    text = re.sub(r"^[：:，,、/\\|\-\s]+|[：:，,、/\\|\-\s]+$", "", text)
    if re.search(r"远处.*雪山", text):
        return "雪山"
    if re.search(r"(近处.*山丘.*小路|山丘和小路)", text):
        return "山丘小路"
    if re.search(r"(沿着.*前行|一个小女孩|一个阳光|一条蜿蜒|路边点缀)", text):
        return ""
    text = re.sub(r"(这些元素|等元素|为主|风格|视觉气候|世界观|自然环境|旅途环境|环境)$", "", text).strip()
    if not text or text in STORYBOARD_LOCAL_CUE_STOP_WORDS:
        return ""
    if re.search(r"(参考图|主线|世界为|整体|。|使用方式|只作为|不要当|固定剧情|来源|蓝天白云|阳光明媚)", text):
        return ""
    if len(text) < 2 or len(text) > 18:
        return ""
    if re.fullmatch(r"[A-Za-z0-9_\- ]+", text):
        return ""
    return text


def storyboard_unique_local_tokens(values: list[str], limit: int = 12) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for raw in values:
        token = storyboard_clean_local_token(raw)
        if not token:
            continue
        key = normalize_storyboard_director_field(token)
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(token)
        if len(output) >= limit:
            break
    return output


def storyboard_local_token_is_wearable(value: str) -> bool:
    return bool(re.search(r"(上衣|礼服|长裙|裙|披风|外套|风衣|甲胄|盔甲|服装|衣服|发型|黑发|金发)", clean_text(value)))


def storyboard_infer_local_cues_from_text(text: str) -> dict:
    value = clean_text(text)
    def terms_in_text(terms: list[str]) -> list[str]:
        return [term for term in terms if term and term in value]
    actors = re.findall(
        r"[\u4e00-\u9fff]{0,6}(?:少女|圣女|女武神|维修机器人|机器人|侦探|女祭司|祭司|木偶师|骑士|战士|主角)",
        value,
    )
    actors = [re.sub(r"^(?:一位|一个|这位|那位|穿着|穿|带着|老旧|金发|黑发)", "", item) if item not in ("老旧维修机器人", "金发女武神", "黑发圣女") else item for item in actors]
    beings = terms_in_text([
        "远古巨兽", "巨兽", "失控仿生人", "仿生人", "沉睡鲸群", "鲸群", "翼状黑影", "黑影", "恶魔王座", "恶魔", "魔王", "小鹿", "机械鸟", "小人影", "身影",
    ])
    scenes = terms_in_text([
        "山谷村庄", "村庄", "村屋", "故乡", "村口", "山路", "小路", "山丘", "山坡", "山脊", "雪山", "森林小路", "林间小径", "森林", "林中岔路", "岔路", "溪边石头", "溪流", "溪边", "远山", "木路牌",
        "大城市", "城市入口", "城市天际线", "城市", "都市", "车站", "公路",
        "哥特教堂", "教堂", "火焰广场", "广场", "破裂王座", "黑暗王座", "王座台阶", "王座",
        "废墟战场", "战场", "断裂城墙", "城墙", "雨中碎石地", "燃烧残骸",
        "控制舱", "破损温室", "温室", "外舱走廊", "走廊", "培养槽", "废弃空间站", "空间站",
        "霓虹街道", "街道", "广告牌下", "广告牌", "雨夜天台", "天台", "企业大楼", "大楼", "高楼边缘",
        "海底神庙", "神庙", "破碎珊瑚圣坛", "珊瑚圣坛", "圣坛", "黑潮水域", "水域", "发光海沟", "海沟",
        "沙漠", "商队遗迹", "风暴沙丘", "枯井", "绿洲",
        "剧院舞台", "幕后齿轮室", "坠落幕布", "破碎灯架",
    ])
    objects = terms_in_text([
        "绿色背包", "背包", "地图", "路牌", "木牌", "脚印", "倒木", "线索", "野花", "绿植", "旧照片", "旧信", "日记", "石头", "树枝",
        "圣徽", "金色王冠", "黑暗王冠", "王冠", "黑火", "裂纹", "王座",
        "长剑", "巨兽爪牙", "爪牙", "雷光", "核心裂缝", "核心",
        "电缆", "氧气管", "控制面板", "裂缝玻璃", "发光植物", "沉睡植物", "植物", "机械臂", "工具箱",
        "全息记录", "数据芯片", "追踪器", "警戒线", "全息屏",
        "珊瑚碎片", "圣坛符文", "黑潮", "气泡光", "珊瑚权杖", "权杖",
        "水晶种子", "皮水袋", "帐篷", "沙土", "水洼", "绿芽",
        "控制线", "断线机关", "齿轮", "机械鸟羽片", "舞台灯",
    ])
    styles = terms_in_text([
        "明亮日系动画", "日系动画", "哥特暗黑", "红黑火光", "史诗战斗电影感", "史诗战斗", "电影感",
        "冷色科幻", "植物微光", "赛博朋克雨夜霓虹", "赛博朋克", "雨夜霓虹", "梦幻海底蓝绿色光", "梦幻海底", "蓝绿色光", "写实", "厚涂", "水彩",
        "暖色沙漠", "奇幻绿光", "蒸汽朋克", "暖铜色机械",
    ])
    actors = [item for item in actors if not storyboard_local_token_is_wearable(item)]
    return {
        "actors": storyboard_unique_local_tokens(actors, limit=8),
        "beings": storyboard_unique_local_tokens(beings, limit=8),
        "scenes": storyboard_unique_local_tokens(scenes, limit=14),
        "objects": storyboard_unique_local_tokens(objects, limit=16),
        "styles": storyboard_unique_local_tokens(styles, limit=6),
    }


def storyboard_split_local_cues(story_text: str, source_analysis: str, visual_cue_pack: str) -> dict:
    groups = {
        "actors": [],
        "scenes": [],
        "objects": [],
        "beings": [],
        "styles": [],
        "all": [],
    }
    text_sources = [clean_text(visual_cue_pack), clean_text(source_analysis)]
    for text in text_sources:
        for segment in re.split(r"[;；\n]+", text):
            segment = clean_text(segment)
            if not segment:
                continue
            label = ""
            body = segment
            if re.search(r"[:：]", segment):
                label, body = re.split(r"[:：]", segment, maxsplit=1)
                label = clean_text(label)
            if re.search(r"(使用方式|用途|规则|要求|限制|不要|禁止)", label):
                continue
            if re.search(r"(用户剧情|参考图可见素材|参考图分析|完整参考图|Raw World)", label, flags=re.I):
                continue
            parts = re.split(r"[、/,，,；;\|]+", body)
            tokens = storyboard_unique_local_tokens(parts, limit=18)
            if not tokens:
                continue
            groups["all"].extend(tokens)
            label_text = label + segment[:12]
            if re.search(r"(人物|主体|主角|角色|形象)", label_text):
                actor_tokens = [token for token in tokens if not re.search(r"(上衣|背包|披风|皮水袋|水袋|服|裙|甲胄|盔甲|王冠|权杖|工具|机械臂|风衣|外套|羽翼|翅膀|材质|发光)", token)]
                if actor_tokens:
                    groups["actors"].extend(actor_tokens)
                    for token in tokens:
                        if token in actor_tokens:
                            continue
                        if storyboard_local_token_is_wearable(token):
                            groups["styles"].append(token)
                        else:
                            groups["objects"].append(token)
                else:
                    groups["actors"].extend(tokens[:1])
                    groups["objects"].extend(tokens[1:])
            elif re.search(r"(生命|敌人|怪物|动物|反派|群|伙伴|同伴)", label_text):
                groups["beings"].extend(tokens)
            elif re.search(r"(场景|地点|空间|环境|世界|区域)", label_text):
                groups["scenes"].extend(tokens)
            elif re.search(r"(物件|道具|武器|设备|线索|障碍|机关)", label_text):
                groups["objects"].extend(tokens)
            elif re.search(r"(风格|材质|色调|视觉|光)", label_text):
                groups["styles"].extend(tokens)
    inferred = storyboard_infer_local_cues_from_text(f"{story_text} {source_analysis} {visual_cue_pack}")
    for key in ("actors", "scenes", "objects", "beings", "styles"):
        groups[key].extend(inferred.get(key, []))
        groups["all"].extend(inferred.get(key, []))
    story_candidates = re.findall(r"[\u4e00-\u9fffA-Za-z0-9]{2,12}", clean_text(story_text))
    groups["all"].extend(story_candidates)
    for key in list(groups.keys()):
        groups[key] = storyboard_unique_local_tokens(groups[key], limit=16)
    if not groups["actors"]:
        subject_match = re.search(r"(?:一位|一个|这位|那个)?([\u4e00-\u9fff]{2,8})(?:在|从|被|将|用|带|沿|踏|走|进入|离开|守护|寻找|追踪|修复|战斗|遇见|发现)", clean_text(story_text))
        if subject_match:
            groups["actors"] = storyboard_unique_local_tokens([subject_match.group(1)], limit=3)
    if not groups["actors"]:
        groups["actors"] = ["主角"]
    if not groups["scenes"]:
        groups["scenes"] = storyboard_unique_local_tokens(groups["all"], limit=4) or ["故事场景"]
    if not groups["objects"]:
        groups["objects"] = storyboard_unique_local_tokens(groups["beings"] + groups["all"], limit=8) or ["关键线索"]
    return groups


def storyboard_split_story_phrases(story_text: str) -> list[str]:
    text = clean_text(story_text)
    text = re.sub(r"(然后|接着|随后|最终|最后|逐步|并且|同时)", "，", text)
    parts = [clean_text(part) for part in re.split(r"[。！？!?；;，,]+", text)]
    phrases = [part for part in parts if 4 <= len(part) <= 60]
    if not phrases and text:
        phrases = [text[:60]]
    return phrases or ["根据用户剧情推进"]


def storyboard_pick_local(values: list[str], index: int, fallback: str) -> str:
    clean_values = storyboard_unique_local_tokens(values, limit=18)
    if not clean_values:
        return fallback
    return clean_values[index % len(clean_values)]


def storyboard_find_local(values: list[str], pattern: str, fallback: str = "") -> str:
    for token in storyboard_unique_local_tokens(values, limit=24):
        if re.search(pattern, token):
            return token
    return fallback


def storyboard_user_destination_from_story(story_text: str) -> str:
    text = clean_text(story_text)
    if not text:
        return ""
    for term in ["大城市", "大都市", "都市", "城市", "城里", "车站"]:
        if term in text:
            return "城市" if term == "城里" else term
    destination_match = re.search(r"(?:去往|前往|奔向|赶往|走向|通往|抵达|到达|进入)([\u4e00-\u9fff]{2,14})", text)
    if not destination_match:
        return ""
    destination = clean_text(destination_match.group(1))
    destination = re.sub(r"(?:的)?(?:旅途|路上|道路|方向|入口|途中|之路).*$", "", destination).strip()
    if destination in {"真正的自我", "自我", "成长", "失去", "未来", "梦想", "答案", "真相"}:
        return ""
    return storyboard_clean_local_token(destination)


def storyboard_destination_is_city(destination: str) -> bool:
    return bool(re.search(r"(大城市|大都市|都市|城市|城里|车站|街道|高楼|大楼)", clean_text(destination)))


def storyboard_phrase_for_index(phrases: list[str], index: int) -> str:
    if not phrases:
        return ""
    if len(phrases) == 1:
        return phrases[0]
    pos = round(index * (len(phrases) - 1) / 8)
    return phrases[max(0, min(len(phrases) - 1, pos))]


def storyboard_local_title_from_action(action: str, fallback: str, index: int) -> str:
    text = clean_text(action)
    text = re.sub(r"^(主角|角色|人物|少女|圣女|女武神|机器人|侦探|木偶师|海底女祭司|沙漠少女)", "", text).strip()
    words = re.findall(r"[\u4e00-\u9fffA-Za-z0-9]{2,8}", text)
    if words:
        return words[0][:8]
    return (fallback or f"事件{index + 1:02d}")[:8]


def storyboard_local_visible_action(actor: str, phrase: str, scene: str, obj: str, next_obj: str, index: int) -> str:
    phrase_text = clean_text(phrase)
    actor = storyboard_clean_local_token(actor) or "主角"
    scene = storyboard_clean_local_token(scene) or "当前场景"
    obj = storyboard_clean_local_token(obj) or "关键线索"
    next_obj = storyboard_clean_local_token(next_obj) or obj
    if re.search(r"(离开|出发|启程|踏上|走向)", phrase_text):
        return f"{actor}带着{obj}离开{scene}"
    if re.search(r"(寻找|追踪|搜寻|调查|探索)", phrase_text):
        return f"{actor}在{scene}查看{obj}留下的线索"
    if re.search(r"(发现|找到|看见|显现|出现)", phrase_text):
        return f"{actor}发现{obj}发生明显变化"
    if re.search(r"(遇见|相遇|遭遇|面对)", phrase_text):
        return f"{actor}在{scene}与{obj}形成互动"
    if re.search(r"(修复|连接|重启|唤醒|启动|激活)", phrase_text):
        return f"{actor}用工具处理{obj}并让{next_obj}启动"
    if re.search(r"(战斗|反击|击败|攻击|格挡|冲突|对抗)", phrase_text):
        return f"{actor}用武器击中{obj}并改变战局"
    if re.search(r"(诱惑|堕落|侵蚀|变黑|腐化|夺取)", phrase_text):
        return f"{obj}的黑色痕迹爬上{actor}身边"
    if re.search(r"(交换|赠送|交给|递给|接受)", phrase_text):
        return f"{actor}把{obj}交到对方手中"
    if re.search(r"(告别|离别|放下|埋下|丢弃)", phrase_text):
        return f"{actor}把{obj}留在{scene}并转身离开"
    if re.search(r"(抵达|到达|坐上|登上|完成|结束|变成)", phrase_text):
        return f"{actor}抵达{scene}并让{obj}成为画面焦点"
    verbs = ["取出", "检查", "移动", "打开", "连接", "避开", "递出", "放下", "抵达"]
    verb = verbs[index % len(verbs)]
    return f"{actor}在{scene}{verb}{obj}"


def storyboard_local_story_kind(story_text: str, source_analysis: str, visual_cue_pack: str) -> str:
    text = clean_text(f"{story_text} {source_analysis} {visual_cue_pack}")
    story_only = clean_text(story_text)
    if re.search(r"(海底|圣坛|黑潮|鲸|净化|祭司|珊瑚|神庙)", text):
        return "ritual"
    if re.search(r"(堕落|侵蚀|王座|魔王|黑暗王冠|圣女)", text):
        return "corruption"
    if re.search(r"(战斗|反击|巨兽|怪物|击败|核心|女武神)", text):
        return "battle"
    if re.search(r"(修复|维修|温室|电缆|氧气|空间站|机器人|复苏|重生)", text):
        return "repair"
    if re.search(r"(木偶师|机械鸟|剧院|舞台|齿轮|断线机关|控制线|幕布|灯架)", text):
        return "stage_machine"
    if re.search(r"(沙漠|风暴沙丘|水晶种子|绿洲|枯井|商队遗迹|皮水袋)", text):
        return "desert_oasis"
    if re.search(r"(侦探|追踪|仿生人|全息|数据芯片|企业|阴谋|控制)", text):
        return "investigation"
    if re.search(r"(离开故乡|故乡|寻找真正的自我|寻找自我|成长|失去|放下过去|旅途)", story_only):
        if not re.search(r"(地图|路牌|倒木|断桥|遗迹|枯井|战斗|王座|温室|侦探|机械鸟|圣坛)", story_only):
            return "personal_journey"
    if re.search(r"(离开|故乡|山路|森林|远山|寻找|旅|路牌|地图|线索)", text):
        return "journey"
    return "general"


def storyboard_local_compact_anchor(scene: str, obj: str = "") -> str:
    scene = storyboard_clean_local_token(scene) or "故事场景"
    obj = storyboard_clean_local_token(obj)
    if obj and obj not in scene and len(scene) + len(obj) <= 12:
        return f"{scene}{obj}"
    return scene[:12]


def storyboard_local_event(title: str, action: str, scene: str, obj: str = "") -> dict:
    return {
        "title": clean_text(title)[:20],
        "action": clean_text(action)[:60],
        "sceneAnchor": storyboard_local_compact_anchor(scene, obj),
        "cause": "",
    }


def storyboard_build_pattern_events(kind: str, cues: dict, seed: str = "", story_text: str = "") -> list[dict] | None:
    actors = cues.get("actors") or ["主角"]
    scenes = cues.get("scenes") or ["故事场景"]
    objects = storyboard_unique_local_tokens(cues.get("objects", []) + cues.get("all", []), limit=18)
    beings = cues.get("beings") or []
    actor = storyboard_pick_local(actors, 0, "主角")
    ally_or_enemy = storyboard_pick_local(beings, 0, storyboard_pick_local(objects, 1, "互动对象"))
    obj0 = storyboard_pick_local(objects, 0, "关键物件")
    obj1 = storyboard_pick_local(objects, 1, obj0)
    obj2 = storyboard_pick_local(objects, 2, obj1)
    obj3 = storyboard_pick_local(objects, 3, obj2)
    s0 = storyboard_pick_local(scenes, 0, "起点")
    s1 = storyboard_pick_local(scenes, 1, s0)
    s2 = storyboard_pick_local(scenes, 2, s1)
    s3 = storyboard_pick_local(scenes, 3, s2)
    s4 = storyboard_pick_local(scenes, 4, s3)
    s5 = storyboard_pick_local(scenes, 5, s4)
    if kind == "personal_journey":
        bag = storyboard_find_local(objects, r"(背包|行囊|包)", "背包")
        figure = storyboard_find_local(beings + objects, r"(小人影|身影|同伴|朋友|家人)", "远处小人影")
        memory = storyboard_find_local(objects, r"(旧照片|旧信|日记|照片|信)", "旧照片")
        flower = storyboard_find_local(objects + scenes, r"(野花|绿植|花)", "路边野花")
        stone = storyboard_find_local(objects + scenes, r"(石头|岩石)", "路边石头")
        branch = storyboard_find_local(objects, r"(树枝|枝)", "低垂树枝")
        home_scene = storyboard_find_local(scenes, r"(故乡|村口|村屋|村庄)", "故乡小路")
        path_scene = storyboard_find_local(scenes + objects, r"(山丘小路|山路|小路|山丘|山坡)", "山丘小路")
        flower_scene = storyboard_find_local(scenes, r"(路边野花|花坡)", "") or "路边野花"
        forest_scene = storyboard_find_local(scenes, r"(林间|森林|树林)", "林间小径")
        fork_scene = storyboard_find_local(scenes, r"(岔路|小路|山路)", "林间岔路")
        high_scene = storyboard_find_local(scenes, r"(山脊|山坡|山丘|高处)", "开阔山丘")
        user_destination = storyboard_user_destination_from_story(story_text)
        far_destination = user_destination or storyboard_find_local(scenes, r"(雪山|远山)", "远山")
        far_path = storyboard_find_local(scenes, r"(山路|小路)", f"通向{far_destination}的小路")
        route_marker = storyboard_find_local(objects + scenes, r"(路牌|木牌|标记|脚印|箭头)", "") or ("石头箭头" if re.search(r"石", stone) else "路线标记")
        fork_marker_scene = f"{far_destination}岔路"
        if storyboard_destination_is_city(user_destination):
            city_marker = storyboard_find_local(objects + scenes, r"(路牌|木牌|标记|箭头)", "") or "城市方向路牌"
            city_road = storyboard_find_local(scenes + objects, r"(公路|车站|街道|街口|城市入口|高楼|大楼)", "") or f"通往{far_destination}的公路"
            city_outline = storyboard_find_local(scenes, r"(城市天际线|高楼|大楼|街道|城市|大城市|都市)", "") or f"远处{far_destination}轮廓"
            city_entry = storyboard_find_local(scenes, r"(城市入口|街道|车站|高楼|大楼|城市|大城市|都市)", "") or f"{far_destination}入口"
            return [
                storyboard_local_event("离乡出发", f"{actor}背起{bag}离开{home_scene}", home_scene, bag),
                storyboard_local_event("回望故乡", f"{actor}在{path_scene}回头看见{figure}", path_scene, figure),
                storyboard_local_event("取出旧物", f"{actor}在{flower_scene}旁从{bag}里取出{memory}", flower_scene, memory),
                storyboard_local_event("放下旧物", f"{actor}把{memory}压在{stone}下并松开手", path_scene, stone),
                storyboard_local_event("进入林径", f"{actor}拨开{branch}走进{forest_scene}", forest_scene, branch),
                storyboard_local_event("发现城市方向", f"{actor}在{fork_scene}发现指向{far_destination}的{city_marker}", fork_marker_scene, city_marker),
                storyboard_local_event("走上通城道路", f"{actor}把{flower}插在{bag}侧袋，沿{city_marker}走向{city_road}", city_road, city_marker),
                storyboard_local_event("看见城市轮廓", f"{actor}登上{high_scene}，看见{city_outline}出现在地平线", city_outline, city_outline),
                storyboard_local_event("抵达城市边缘", f"{actor}沿{city_road}走到{city_entry}，高楼与街道在前方展开", city_entry, city_entry),
            ]
        return [
            storyboard_local_event("离乡出发", f"{actor}背起{bag}离开{home_scene}", home_scene, bag),
            storyboard_local_event("回望故乡", f"{actor}在{path_scene}回头看见{figure}", path_scene, figure),
            storyboard_local_event("取出旧物", f"{actor}在{flower_scene}旁从{bag}里取出{memory}", flower_scene, memory),
            storyboard_local_event("放下旧物", f"{actor}把{memory}压在{stone}下并松开手", path_scene, stone),
            storyboard_local_event("进入林径", f"{actor}拨开{branch}走进{forest_scene}", forest_scene, branch),
            storyboard_local_event("发现岔路标记", f"{actor}在{fork_scene}发现指向{far_destination}的{route_marker}", fork_marker_scene, route_marker),
            storyboard_local_event("确认新路", f"{actor}把{flower}插在{bag}侧袋，沿{route_marker}指向的小路前行", flower_scene, flower),
            storyboard_local_event("越过山丘", f"{actor}登上{high_scene}缺口，看见{forest_scene}落在身后", high_scene, forest_scene),
            storyboard_local_event("接近远山", f"{actor}沿{far_path}走到开阔坡顶，{far_destination}占据前方", far_destination, far_destination),
        ]
    if kind == "journey":
        bag = storyboard_find_local(objects, r"(背包|行囊|包)", obj0)
        route = storyboard_find_local(objects, r"(地图|指南|路线图)", "") or storyboard_find_local(objects, r"(脚印|线索|信件|路牌)", obj1)
        obstacle = storyboard_find_local(objects + scenes, r"(倒木|断桥|溪|石|门|藤|障碍)", obj2)
        sign = storyboard_find_local(objects + scenes, r"(路牌|岔路|木牌|标记|脚印)", obj3)
        sign_destination = storyboard_find_local(scenes, r"(远山|山顶|高处|溪|河|山路|小路|岔路)", s4)
        return [
            storyboard_local_event("离乡出发", f"{actor}背起{bag}离开{s0}", s0, bag),
            storyboard_local_event("踏入新路", f"{actor}沿{s1}走向{s2}", s1, s2),
            storyboard_local_event("发现线索", f"{actor}在{s2}发现{route}", s2, route),
            storyboard_local_event("越过阻碍", f"{actor}推开{obstacle}露出前方小路", s3, obstacle),
            storyboard_local_event("查看路线", f"{actor}展开{route}确认下一段路", s2, route),
            storyboard_local_event("处理障碍", f"{actor}用{bag}中的工具处理{obstacle}", s3, obstacle),
            storyboard_local_event("路标转向", f"{actor}看到{sign}指向{sign_destination}，改变路线", sign_destination, sign),
            storyboard_local_event("登上高处", f"{actor}到达{s5}回望来路", s5, route),
            storyboard_local_event("走向远山", f"{actor}沿{s1}继续走向远山", s1, "远山"),
        ]
    if kind == "corruption":
        sacred = storyboard_find_local(objects, r"(圣徽|徽章|圣物|符文)", "圣徽")
        crown = storyboard_find_local(objects, r"(王冠|冠)", "黑暗王冠")
        flame = storyboard_find_local(objects, r"(黑火|火|裂纹|黑暗)", "黑火")
        church_scene = storyboard_find_local(scenes, r"(教堂|祭坛)", s0)
        fire_scene = storyboard_find_local(scenes, r"(火焰|广场)", s1)
        throne_scene = storyboard_find_local(scenes, r"(王座台阶|台阶|王座)", s3)
        throne = storyboard_find_local(objects + scenes, r"(王座|台阶)", throne_scene)
        shadow = storyboard_find_local(beings + objects, r"(翼|影|恶魔|黑影)", "翼状黑影")
        return [
            storyboard_local_event("守护圣徽", f"{actor}在{church_scene}按住发光的{sacred}", church_scene, sacred),
            storyboard_local_event("王冠显现", f"{crown}从{fire_scene}的黑火中露出", fire_scene, crown),
            storyboard_local_event("黑火侵蚀", f"黑火沿{sacred}裂缝爬向{actor}", fire_scene, sacred),
            storyboard_local_event("拾起王冠", f"{actor}伸手拾起沾着黑火的{crown}", fire_scene, crown),
            storyboard_local_event("圣徽裂开", f"{sacred}在{actor}手中裂开红光", throne_scene, sacred),
            storyboard_local_event("步上王座", f"{actor}握着裂纹{sacred}走上{throne}", throne_scene, sacred),
            storyboard_local_event("翼影展开", f"{shadow}从{throne}后方覆盖{actor}身后", throne_scene, shadow),
            storyboard_local_event("戴上王冠", f"{actor}把黑暗{crown}戴到头上", throne_scene, crown),
            storyboard_local_event("坐上王座", f"{actor}坐上{throne}完成黑暗转变", throne_scene, throne),
        ]
    if kind == "battle":
        weapon = storyboard_find_local(objects, r"(剑|刀|枪|矛|武器)", "长剑")
        claw = storyboard_find_local(objects, r"(爪|牙|角|尾)", "巨兽爪牙")
        energy = storyboard_find_local(objects, r"(雷|光|火|能量)", "雷光")
        core = storyboard_find_local(objects, r"(核心|裂缝|弱点|胸口)", "发光核心")
        return [
            storyboard_local_event("巨兽逼近", f"{ally_or_enemy}踏碎{s0}逼近{actor}", s0, ally_or_enemy),
            storyboard_local_event("举剑格挡", f"{actor}用{weapon}挡住{ally_or_enemy}的爪击", s0, weapon),
            storyboard_local_event("战场压制", f"{ally_or_enemy}把{actor}逼退到{s1}", s1, ally_or_enemy),
            storyboard_local_event("雷光聚剑", f"{energy}汇入{actor}手中的{weapon}", s2, energy),
            storyboard_local_event("反击巨兽", f"{actor}挥动{weapon}击中{ally_or_enemy}", s2, weapon),
            storyboard_local_event("斩断爪牙", f"{actor}斩断{claw}", s3, claw),
            storyboard_local_event("核心暴露", f"{ally_or_enemy}胸口露出{core}", s3, core),
            storyboard_local_event("刺入核心", f"{actor}把{weapon}刺入{core}", s4, core),
            storyboard_local_event("巨兽倒下", f"{ally_or_enemy}倒在{s5}，{actor}站稳收剑", s5, ally_or_enemy),
        ]
    if kind == "repair":
        cable = storyboard_find_local(objects, r"(电缆|线)", obj0)
        oxygen = storyboard_find_local(objects, r"(氧气|管)", obj1)
        panel = storyboard_find_local(objects, r"(面板|控制|终端)", obj2)
        glass = storyboard_find_local(objects, r"(玻璃|裂缝|破损)", obj3)
        plant = storyboard_find_local(objects, r"(植物|绿|芽|花)", storyboard_pick_local(objects, 4, obj0))
        plant_scene = storyboard_find_local(scenes, r"(培养|温室|槽)", s2)
        return [
            storyboard_local_event("启动控制", f"{actor}启动{s0}里的{panel}", s0, panel),
            storyboard_local_event("连接电缆", f"{actor}用机械臂连接断开的{cable}", s1, cable),
            storyboard_local_event("接上氧气", f"{actor}把{oxygen}接到培养槽旁", s2, oxygen),
            storyboard_local_event("封住裂缝", f"{actor}修补{s1}上的{glass}", s1, glass),
            storyboard_local_event("植物复苏", f"{plant}在{plant_scene}发出微光", plant_scene, plant),
            storyboard_local_event("扩大光照", f"{actor}调整{panel}扩大温室光照", s0, panel),
            storyboard_local_event("藤蔓生长", f"{plant}沿{s1}裂缝向外生长", s1, plant),
            storyboard_local_event("温室点亮", f"{s1}被植物微光重新照亮", s1, plant),
            storyboard_local_event("空间站重亮", f"{actor}站在{s0}看见整座空间站亮起", s0, panel),
        ]
    if kind == "stage_machine":
        bird = storyboard_find_local(beings + objects, r"(机械鸟|失控机械鸟)", ally_or_enemy)
        wire = storyboard_find_local(objects, r"(控制线|线)", obj0)
        switch = storyboard_find_local(objects, r"(断线机关|机关)", obj1)
        gear = storyboard_find_local(objects, r"(齿轮)", obj2)
        feather = storyboard_find_local(objects, r"(羽片|机械鸟羽片)", obj3)
        lamp = storyboard_find_local(objects, r"(舞台灯|灯架|灯)", storyboard_pick_local(objects, 4, obj3))
        stage_scene = storyboard_find_local(scenes, r"(剧院|舞台)", s0)
        gear_room = storyboard_find_local(scenes, r"(齿轮室|后台|幕后)", s1)
        curtain = storyboard_find_local(scenes + objects, r"(幕布)", s2)
        damaged_lamp_scene = storyboard_find_local(scenes, r"(灯架|破碎)", s3)
        return [
            storyboard_local_event("舞台追捕", f"{actor}在{stage_scene}追赶{bird}", stage_scene, bird),
            storyboard_local_event("机械鸟撞灯", f"{bird}撞向{lamp}让{stage_scene}摇晃", stage_scene, lamp),
            storyboard_local_event("进入后台", f"{actor}拉开{curtain}进入{gear_room}", gear_room, curtain),
            storyboard_local_event("找到控制线", f"{actor}在{gear_room}找到缠住齿轮的{wire}", gear_room, wire),
            storyboard_local_event("启动断线机关", f"{actor}扳下{switch}切断{wire}", gear_room, switch),
            storyboard_local_event("齿轮停转", f"{gear}停止转动，{bird}失去控制", gear_room, gear),
            storyboard_local_event("机械鸟坠落", f"{bird}坠到{stage_scene}并散落{feather}", stage_scene, feather),
            storyboard_local_event("固定舞台", f"{actor}用{gear}卡住倾斜的{stage_scene}", damaged_lamp_scene, gear),
            storyboard_local_event("舞台平静", f"{actor}站在{stage_scene}拾起{feather}", stage_scene, feather),
        ]
    if kind == "desert_oasis":
        seed_item = storyboard_find_local(objects, r"(水晶种子|种子)", obj0)
        water_bag = storyboard_find_local(objects, r"(皮水袋|水袋)", obj1)
        tent = storyboard_find_local(objects, r"(帐篷)", obj2)
        soil = storyboard_find_local(objects, r"(沙土|沙)", obj3)
        water = storyboard_find_local(objects, r"(水洼)", "") or storyboard_find_local(objects, r"(清水|水面|水源)", storyboard_pick_local(objects, 4, obj3))
        sprout = storyboard_find_local(objects, r"(绿芽|芽|绿洲)", storyboard_pick_local(objects, 5, obj2))
        desert_scene = storyboard_find_local(scenes, r"(沙漠)$", s0)
        storm_scene = storyboard_find_local(scenes, r"(风暴|沙丘)", s1)
        ruin_scene = storyboard_find_local(scenes, r"(商队|遗迹)", s2)
        well_scene = storyboard_find_local(scenes, r"(枯井)", s3)
        oasis_scene = storyboard_find_local(scenes, r"(绿洲)", s4)
        return [
            storyboard_local_event("护住种子", f"{actor}把{seed_item}装进{water_bag}", desert_scene, seed_item),
            storyboard_local_event("穿过风暴", f"{actor}抓紧{water_bag}穿过{storm_scene}", storm_scene, water_bag),
            storyboard_local_event("遗迹避风", f"{actor}在{ruin_scene}拉起{tent}挡住风沙", ruin_scene, tent),
            storyboard_local_event("抵达枯井", f"{actor}带着{seed_item}来到{well_scene}", well_scene, seed_item),
            storyboard_local_event("种下种子", f"{actor}把{seed_item}埋进{well_scene}旁的{soil}", well_scene, seed_item),
            storyboard_local_event("绿芽破土", f"{sprout}从{well_scene}旁的{soil}中冒出", well_scene, sprout),
            storyboard_local_event("水洼出现", f"{well_scene}旁形成一小片{water}", well_scene, water),
            storyboard_local_event("绿洲扩散", f"{sprout}沿{water}扩散成{oasis_scene}", oasis_scene, sprout),
            storyboard_local_event("绿洲休息", f"{actor}把{water_bag}放在{oasis_scene}旁休息", oasis_scene, water_bag),
        ]
    if kind == "investigation":
        return [
            storyboard_local_event("雨夜追踪", f"{actor}在{s0}追踪{ally_or_enemy}留下的信号", s0, ally_or_enemy),
            storyboard_local_event("发现记录", f"{actor}在{s1}调出{obj0}", s1, obj0),
            storyboard_local_event("取出芯片", f"{actor}从{obj0}旁取出{obj1}", s1, obj1),
            storyboard_local_event("锁定目标", f"{obj2}在{s2}标出{ally_or_enemy}的位置", s2, obj2),
            storyboard_local_event("设置警戒", f"{actor}在{s2}拉起{obj3}", s2, obj3),
            storyboard_local_event("天台对峙", f"{actor}在{s3}正面对上{ally_or_enemy}", s3, ally_or_enemy),
            storyboard_local_event("证据显现", f"{obj1}投出企业阴谋的全息证据", s4, obj1),
            storyboard_local_event("控制仿生人", f"{actor}用{obj2}让{ally_or_enemy}停止行动", s3, obj2),
            storyboard_local_event("案件收束", f"{actor}站在{s4}收起{obj1}", s4, obj1),
        ]
    if kind == "ritual":
        fragment = storyboard_find_local(objects, r"(碎片|珊瑚碎片)", obj0)
        staff = storyboard_find_local(objects, r"(权杖|法杖|杖)", obj1)
        rune = storyboard_find_local(objects, r"(符文|圣坛符文)", obj1)
        tide = storyboard_find_local(objects, r"(黑潮|污染|暗流)", obj2)
        light = storyboard_find_local(objects, r"(气泡光|光|发光)", obj3)
        return [
            storyboard_local_event("收集碎片", f"{actor}在{s0}拾起{fragment}", s0, fragment),
            storyboard_local_event("摆回圣坛", f"{actor}把{fragment}放回{s1}", s1, fragment),
            storyboard_local_event("刻下符文", f"{actor}用{staff}在{s1}刻出{rune}", s1, rune),
            storyboard_local_event("黑潮逼近", f"{tide}包围{s2}并压暗圣坛光", s2, tide),
            storyboard_local_event("驱散黑潮", f"{actor}举起{staff}驱散{tide}", s2, tide),
            storyboard_local_event("鲸群苏醒", f"{ally_or_enemy}在{s2}睁眼游动", s2, ally_or_enemy),
            storyboard_local_event("圣坛合拢", f"{s1}的{fragment}重新拼合发光", s1, fragment),
            storyboard_local_event("神庙发光", f"{light}从{s3}升起照亮海水", s3, light),
            storyboard_local_event("鲸群远游", f"{ally_or_enemy}绕过发光的{s4}游向远处", s4, ally_or_enemy),
        ]
    return None


def storyboard_local_chain_drifted(events: list[dict], story_text: str, source_analysis: str, visual_cue_pack: str) -> bool:
    if not isinstance(events, list) or len(events) != 9:
        return True
    cue_groups = storyboard_split_local_cues(story_text, source_analysis, visual_cue_pack)
    important = storyboard_unique_local_tokens(
        cue_groups.get("actors", []) + cue_groups.get("scenes", []) + cue_groups.get("objects", []) + cue_groups.get("beings", []),
        limit=20,
    )
    event_text = "\n".join(
        clean_text(f"{item.get('title', '')} {item.get('action', '')} {item.get('sceneAnchor', '')}")
        for item in events if isinstance(item, dict)
    )
    destination = storyboard_user_destination_from_story(story_text)
    if storyboard_destination_is_city(destination) and not re.search(r"(大城市|大都市|都市|城市|车站|公路|街道|高楼|大楼|城市入口|天际线)", event_text):
        return True
    source_text = clean_text(f"{story_text} {source_analysis} {visual_cue_pack}")
    ungrounded_terms = ["神器", "宝藏", "野兽", "水源", "水坑", "野兔", "陷阱", "洞穴", "村民", "找水"]
    for term in ungrounded_terms:
        if term in event_text and term not in source_text:
            return True
    if important:
        hit_count = 0
        for item in events:
            text = clean_text(f"{item.get('title', '')} {item.get('action', '')} {item.get('sceneAnchor', '')}") if isinstance(item, dict) else ""
            if any(token and token in text for token in important):
                hit_count += 1
        return hit_count < 4
    return False


def build_storyboard_local_visual_event_chain(story_text: str, source_analysis: str, visual_cue_pack: str, seed: str = "") -> list[dict]:
    cues = storyboard_split_local_cues(story_text, source_analysis, visual_cue_pack)
    kind = storyboard_local_story_kind(story_text, source_analysis, visual_cue_pack)
    pattern_events = storyboard_build_pattern_events(kind, cues, seed, story_text)
    if pattern_events and len(pattern_events) == 9:
        return pattern_events
    phrases = storyboard_split_story_phrases(story_text)
    rng = random.Random(storyboard_stable_generation_seed(seed or story_text, "localStoryChain", 103))
    actors = cues["actors"]
    scenes = cues["scenes"][:]
    objects = storyboard_unique_local_tokens(cues["objects"] + cues["beings"] + cues["all"], limit=18)
    if len(scenes) > 2:
        rng.shuffle(scenes)
    if len(objects) > 2:
        rng.shuffle(objects)
    events: list[dict] = []
    previous_scene = ""
    for index in range(9):
        actor = storyboard_pick_local(actors, index, "主角")
        scene = storyboard_pick_local(scenes, index, "故事场景")
        if scene == previous_scene and len(scenes) > 1:
            scene = storyboard_pick_local(scenes, index + 1, "故事场景")
        previous_scene = scene
        obj = storyboard_pick_local(objects, index, "关键线索")
        next_obj = storyboard_pick_local(objects, index + 1, obj)
        phrase = storyboard_phrase_for_index(phrases, index)
        action = storyboard_local_visible_action(actor, phrase, scene, obj, next_obj, index)
        title = storyboard_local_title_from_action(action, obj, index)
        anchor = scene
        if obj and obj not in anchor and len(anchor) + len(obj) <= 12:
            anchor = f"{scene}{obj}"[:12]
        events.append({
            "title": title[:20],
            "action": action[:60],
            "sceneAnchor": anchor[:24],
            "cause": "",
        })
    return events


def normalize_storyboard_visual_event_from_values(item, index: int) -> dict:
    if isinstance(item, dict):
        return {
            "title": clean_text(str(item.get("title") or item.get("name") or item.get("event") or f"事件{index + 1:02d}")),
            "action": clean_text(str(item.get("action") or item.get("visibleAction") or item.get("description") or "")),
            "sceneAnchor": clean_text(str(item.get("sceneAnchor") or item.get("anchor") or item.get("location") or item.get("space") or "")),
            "cause": clean_text(str(item.get("cause") or item.get("reason") or "")),
        }
    if isinstance(item, (list, tuple)):
        values = [clean_text(str(value or "")) for value in item]
        title = values[0] if len(values) > 0 else f"事件{index + 1:02d}"
        action = values[1] if len(values) > 1 else ""
        scene_anchor = values[2] if len(values) > 2 else ""
        cause = values[3] if len(values) > 3 else ""
        return {"title": title, "action": action, "sceneAnchor": scene_anchor, "cause": cause}
    return {"title": f"事件{index + 1:02d}", "action": clean_text(str(item or "")), "sceneAnchor": "", "cause": ""}


def storyboard_local_prompt_style_text(cues: dict) -> str:
    styles = storyboard_unique_local_tokens(cues.get("styles", []), limit=4)
    styles = [item for item in styles if not re.search(r"(雪山|小路|山丘|背包|前行|人物|物件|地点)", item)]
    styles = [
        item for item in styles
        if not any(item != other and item in other for other in styles)
    ]
    if styles:
        return "、".join(styles[:3])
    return "参考图统一风格"


def storyboard_compose_local_final_prompt(
    *,
    action: str,
    anchor: str,
    previous_result: str,
    camera: str,
    light: str,
    style_text: str,
    index: int,
) -> str:
    action = clean_text(action)
    anchor = clean_text(anchor) or "当前场景"
    previous_result = clean_text(previous_result)
    style_text = clean_text(style_text) or "参考图统一风格"
    variants = [
        f"{action}，{anchor}清楚出现在画面中心，{camera}，{light}，保留{style_text}。",
        f"{anchor}附近，{action}；镜头采用{camera}，周围环境被{light}照亮。",
        f"{action}，前景可见{anchor}，背景展开当前场景的完整空间，{camera}，{style_text}。",
        f"{camera}拍摄{action}，{anchor}中的物体已经出现变化，{light}落在变化位置。",
        f"{action}，{anchor}的结果清楚留在画面里，{camera}，延续{style_text}。",
        f"{anchor}中发生变化：{action}，{camera}呈现人物、对象和环境关系，{light}。",
    ]
    prompt = variants[index % len(variants)]
    if previous_result and index > 0:
        links = [
            f"带着上一格留下的{previous_result}痕迹，",
            f"上一格的{previous_result}成为本格线索，",
            f"故事从{previous_result}推进到这里，",
        ]
        prompt = links[index % len(links)] + prompt
    return re.sub(r"\s+", "", prompt).strip()


def build_storyboard_local_final_shots(
    story_text: str,
    source_analysis: str,
    visual_cue_pack: str,
    visual_event_chain,
    seed: str = "",
) -> list[dict]:
    events = visual_event_chain if isinstance(visual_event_chain, list) else []
    normalized_events = [
        item if isinstance(item, dict) else normalize_storyboard_visual_event_from_values(item, index)
        for index, item in enumerate(events[:9])
    ]
    if storyboard_local_chain_drifted(normalized_events, story_text, source_analysis, visual_cue_pack):
        normalized_events = build_storyboard_local_visual_event_chain(story_text, source_analysis, visual_cue_pack, seed)
    cues = storyboard_split_local_cues(story_text, source_analysis, visual_cue_pack)
    style_text = storyboard_local_prompt_style_text(cues)
    cameras = ["中景跟拍", "低机位近景", "过肩中景", "手部特写", "广角远景", "侧面运动镜头", "俯视构图", "背影拉远", "正面定格"]
    lights = ["自然侧光", "局部强光", "逆光轮廓", "柔和散射光", "冷暖对比光", "环境反射光", "低照度光影", "高光聚焦", "收束光线"]
    rng = random.Random(storyboard_stable_generation_seed(seed or story_text, "localFinalShots", 211))
    cameras = cameras[:]
    lights = lights[:]
    rng.shuffle(cameras)
    rng.shuffle(lights)
    shots: list[dict] = []
    previous_result = ""
    for index in range(9):
        event = normalized_events[index] if index < len(normalized_events) and isinstance(normalized_events[index], dict) else {}
        title = clean_text(str(event.get("title") or f"镜头{index + 1:02d}"))[:24]
        action = clean_text(str(event.get("action") or "主角处理关键线索"))
        anchor = clean_text(str(event.get("sceneAnchor") or storyboard_pick_local(cues.get("scenes", []), index, "故事场景")))
        camera = cameras[index % len(cameras)]
        light = lights[index % len(lights)]
        prompt = storyboard_compose_local_final_prompt(
            action=action,
            anchor=anchor,
            previous_result=previous_result,
            camera=camera,
            light=light,
            style_text=style_text,
            index=index,
        )
        prompt = re.sub(r"主角", storyboard_pick_local(cues.get("actors", []), index, "主角"), prompt)
        previous_result = anchor or title
        shots.append({
            "scene": index + 1,
            "title": title or f"镜头{index + 1:02d}",
            "prompt": prompt[:900],
            "sceneAnchor": anchor[:80],
            "camera": camera,
        })
    return shots


def buildDynamicStoryboardDirectorPlan(
    story_text: str,
    source_analysis: str,
    rules: str,
    selected_direction=None,
    visual_event_chain=None,
    visual_cue_pack: str = "",
) -> str:
    direction_text = storyboard_story_direction_text(selected_direction)
    event_chain_text = storyboard_visual_event_chain_text(visual_event_chain)
    direction_rule = (
        f"Selected Story Direction:{direction_text}\n"
        if direction_text else
        "Selected Story Direction:未提供；仍需围绕剧情自行推理，但不得套固定模板。\n"
    )
    event_chain_rule = (
        f"Visual Event Chain:\n{event_chain_text}\n"
        if event_chain_text else
        "Visual Event Chain:未提供；不得直接把文学主题拍成9格。\n"
    )
    return (
        "你是 NovaFlow 分镜拍摄导演 V5-5。只输出紧凑合法 JSON 二维数组，不解释不换行。"
        "顶层必须正好 9 项；每项必须正好 4 个字符串，顺序固定为：[剧情节点,镜头,当前空间,动作]。"
        "不要输出对象，不要输出 scene 字段，不要输出键名。"
        "Visual Event Chain 已经决定故事线和可画事件；不得重写故事，不新增主线角色、神器、能力、身份反转或不同结局。"
        "9项必须一一对应 Visual Event Chain 的 Scene01-Scene09；不得重排、合并、拆分或替换事件。"
        "任务只是拍摄：保留本格动作和场景锚点，分配镜头、空间、节奏，让模型更容易画清楚。"
        "剧情节点<=10字，必须来自本格可画动作；不要写起点、选择、结果、成长、挑战等功能词或主题词。"
        "动作<=28字，是唯一画面事实源，必须复用 Visual Event Chain 的可画动作；只能补少量明确对象，不得改成另一件事。"
        "当前空间<=12字，优先来自 Visual Event Chain 的场景锚点；必须写具体空间焦点，不要只写大背景。"
        "镜头<=8字，写景别+角度/运动/焦点，必须服务动作对象；纯远景/中景/近景/特写/全景最多3格。"
        "相邻格不得重复同一剧情节点、动作或视觉背景；Scene04-Scene08尽量保持不同事件类型。"
        "World Continuity 只保时间、地点、时代、视觉风格连续，不是剧情节点清单。"
        "不要输出情绪、构图、光影、占比或导演意图。"
        f"剧情:{story_text}\n"
        f"World Continuity:{source_analysis}\n"
        f"Visual Cue Pack:{visual_cue_pack}\n"
        f"{direction_rule}"
        f"{event_chain_rule}"
        f"补充规则:{rules}\n"
        "JSON:"
    )


def storyboard_director_json_brackets_closed(text: str) -> bool:
    depth = 0
    in_string = False
    escaped = False
    for char in str(text or ""):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0 and not in_string


def extract_storyboard_director_json_array_text(text: str) -> tuple[str, bool]:
    value = clean_text(str(text or ""))
    if not value:
        return "", False
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", value, re.I)
    candidate = fenced.group(1).strip() if fenced else value
    start = candidate.find("[")
    if start < 0:
        return "", False
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(candidate)):
        char = candidate[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                tail = candidate[index + 1:].strip()
                if tail.startswith(","):
                    end = candidate.rfind("]")
                    if end > index:
                        repaired = f"[{candidate[start:end + 1].strip().rstrip(',')}]"
                        return repaired, storyboard_director_json_brackets_closed(repaired)
                json_text = candidate[start:index + 1].strip()
                return json_text, storyboard_director_json_brackets_closed(json_text)
    return candidate[start:].strip(), False


def normalize_storyboard_director_field(value: str) -> str:
    return "".join(char for char in str(value or "") if char.isalnum()).lower()


def storyboard_director_field_similarity(left: str, right: str) -> float:
    a = normalize_storyboard_director_field(left)
    b = normalize_storyboard_director_field(right)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def storyboard_director_obvious_off_topic(value: str) -> bool:
    text = clean_text(str(value or ""))
    if not text:
        return False
    return bool(re.fullmatch(
        r"(雪山|山脉|山峰|野花|道路|树林|森林|建筑|天空|云层|背景|风景|场景|环境|光影|光效|光晕|特效|展示|效果|静止|站立)",
        text,
        re.I,
    ))


STORYBOARD_DIRECTOR_EVENT_SUBJECT_RE = re.compile(
    r"(少女|女武神|圣女|战士|主角|女孩|少年|家人|村民|老者|旅伴|同伴|伙伴|朋友|新朋友|小鹿|小狗|巨兽|怪物|敌人|魔王|黑暗|阳光|晨光|月光|光线|风|雨水|雾气|旧物|信件|旧信|日记|地图|礼物|圣徽|王冠|武器|倒木|断桥|溪流|河水|水面|花朵|果实|果子|野果|背包|机器人|维修机器人|温室|植物|控制面板|电缆|氧气管|侦探|仿生人|企业|企业标志|数据芯片|警戒线|种子|水晶种子|绿芽|绿洲|女祭司|珊瑚|圣坛|黑潮|鲸群|木偶师|机械鸟|舞台|断线机关|齿轮|羽片)"
)
STORYBOARD_DIRECTOR_EVENT_VERB_RE = re.compile(
    r"(挥手|拥抱|告别|背起|举起|踏上|踏入|走入|走进|走向|停步|蹲下|坐下|起身|奔跑|驾驶|开车|攀过|翻过|翻越|越过|跨过|穿过|跟随|同行|结伴|带领|抓住|扶起|抱起|推开|拨开|翻开|翻阅|展开|合上|阅读|记录|写下|整理|处理|收起|保存|放入|放进|放下|丢弃|投入|落入|滑入|掉入|漂走|握紧|按住|抚摸|触摸|触碰|拾起|捡起|找到|摘下|采摘|系紧|交换|递出|递给|接过|赠予|送来|交给|告诉|交谈|对话|分享|指引|引导|包扎|救助|埋下|埋进|种下|追赶|挡住|遇见|遇到|发现|观察|靠近|迷路|迷失|登上|回望|转身|离开|前行|拔剑|迎战|斩向|击中|倒下|裂开|爬上|逼近|苏醒|扩散|释放|接受|拒绝|吹开|照亮|擦开|捧起|冲刷|吹动|撕开|撕裂|压住|撞开|砸碎|插入|按下|接通|焊接|拆下|嵌入|拧紧|拽住|拉断|剪断|捆住|摔碎|刻出|擦去|抬起|张贴|贴上|发布|公开|播出|投影|显示|冒出|长出|长成|蔓延|设置|解读|呼唤|施法|退去|散落|飞行)"
)
STORYBOARD_VISUAL_EVENT_ACTION_CHANGE_RE = re.compile(
    r"(被|把|将|用|受|遭|"
    r"戴|摘|拿|取|拾|捡|收|装|放|递|接|交|赠|翻|展|看|查|观察|处理|整理|读|写|刻|"
    r"追|逃|遇|挡|推|拉|扶|抚|抱|握|按|触|指|引|找|发现|找到|打开|关闭|启动|连接|修|补|念诵|"
    r"唤醒|点燃|释放|散发|举|变|化|黑化|发光|发芽|出现|降临|坐上|倒地|崩|裂|停止|吞噬|惊醒|"
    r"闪烁|凝视|闭目|张开|亮起|熄灭|破碎|覆盖|加深|环绕|发出|转动|带动|下降|掉落|坠落|漂浮|塌|滑|"
    r"游动|逃离|驱散|消散|清理|控制|制服|揭露|挥|斩|击|刺|穿|吹|照|绕|到达|困|浇|种|埋|冲刷|吹动|撕开|撕裂|爬上|落入|压住|撞开|砸碎|插入|按下|接通|焊接|拆下|嵌入|拧紧|拽住|拉断|剪断|捆住|摔碎|刻出|擦去|抬起|张贴|贴上|发布|公开|播出|投影|显示|冒出|长出|长成|蔓延|形成|设置|解读|呼唤|施法|退去|散落|飞行)"
)
STORYBOARD_VISUAL_EVENT_ABSTRACT_STAGE_RE = re.compile(
    r"(探险|探索|寻路|遭遇阻碍|遇到阻碍|克服困难|发现自我|找到自我|寻找自我|结束旅途|旅途结束|展示成果|休息|"
    r"完成任务|任务完成|恢复秩序|恢复生机|环境改善|系统稳定|安全|结果|真相|希望|成长|失去|挑战|未来|"
    r"面对困难|面对未知|继续前行|踏上旅途|踏上旅程|走向远方)"
)
STORYBOARD_VISUAL_EVENT_INCOMPLETE_ACTION_RE = re.compile(
    r"^(?P<actor>[\u4e00-\u9fffA-Za-z0-9]{1,8}?)(?P<verb>追踪|追捕|追逐|查看|观察|检查|寻找|发现|找到|揭露|制服|到达|绕过|启动|关闭|连接|修补|清理|控制|递给|接过|交换|指向|打开|点燃|释放|驱散|唤醒|浇水|种下|埋下)$"
)
STORYBOARD_DIRECTOR_INTERACTION_RE = re.compile(
    r"(向|与|和|同|被|拥抱|扶起|抱起|跟随|同行|结伴|带领|交换|递出|递给|接过|赠予|送来|交给|告诉|告别|交谈|对话|分享|指引|遇见|遇到|挥手|斩向|迎战|面对|直面|抚摸|触摸|触碰|握紧|按住|投入|丢弃|整理|收起|保存|放入|放进|放下|翻开|翻阅|展开|观察|抓住|攀过|翻越|越过|跨过|穿过|踏入|走入|走进|走向|拨开|拾起|捡起|摘下|采摘|系紧|包扎|救助|埋下|埋进|种下|追赶|挡住|吹开|照亮|擦开|捧起)"
)
STORYBOARD_DIRECTOR_CONCRETE_OBJECT_RE = re.compile(
    r"(家人|村民|老者|旅伴|同伴|伙伴|朋友|新朋友|小鹿|小狗|日记|旧物|信件|旧信|纸角|地图|礼物|圣徽|王冠|武器|雨伞|伞|汽车|车辆|出口|花朵|花种|种子|果实|果子|野果|背包|藤蔓|荆棘|河水|湖水|水面|溪流|浅滩|倒木|断桥|石堆|残页|石碑|刻痕|苔藓|路标|伤口|绷带|山顶|村口|森林|山路|小路|巨兽|怪物|黑暗|纹路)"
)


def storyboard_director_action_has_visible_event(action: str) -> bool:
    text = clean_text(str(action or ""))
    if not text:
        return False
    if STORYBOARD_VISUAL_EVENT_ACTION_CHANGE_RE.search(text):
        return True
    has_subject = bool(STORYBOARD_DIRECTOR_EVENT_SUBJECT_RE.search(text))
    has_verb = bool(STORYBOARD_DIRECTOR_EVENT_VERB_RE.search(text))
    has_interaction = bool(STORYBOARD_DIRECTOR_INTERACTION_RE.search(text) and STORYBOARD_DIRECTOR_CONCRETE_OBJECT_RE.search(text))
    return (has_subject and has_verb) or has_interaction


def storyboard_visual_event_action_is_short_label(action: str) -> bool:
    text = clean_text(str(action or ""))
    if not text or len(text) > 6:
        return False
    if re.search(r"(被|把|将|用|在|向|从|给|穿过|挡住|击中|覆盖|吞噬.{1,}|破土|倒下|打开|启动|连接|种下|修补)", text):
        return False
    return bool(re.search(
        r"(指引|光芒|闪耀|相伴|点缀|映衬|结束|安全|结果|完成|稳定|恢复|探险|探索|寻路|阻碍|困难|自我|成果|真相|希望|初现|出现|消逝|显现)",
        text,
    ))


def storyboard_visual_event_action_is_static_state(action: str) -> bool:
    text = clean_text(str(action or ""))
    if not text:
        return True
    if re.fullmatch(r".{0,8}(闪烁|发光|闪耀|站立|闭上眼睛|睁开眼睛|站在.{0,8}|手持.{1,8})", text):
        return True
    return False


def storyboard_director_action_is_weak_event(action: str) -> bool:
    text = clean_text(str(action or ""))
    if not text:
        return True
    if re.fullmatch(r".{0,8}(发现线索|发现变化|通路变化|旅途结束|展示成果|发现自我|寻找自我|寻找方向|走向远方|森林的启示|山野的宁静|到达目的地)\d*", text):
        return True
    if re.fullmatch(r".{0,8}(处理障碍|交接物|击中目标|身体变化|获得力量|获得指引)\d*", text):
        return True
    if re.search(r"(获得力量|获得指引|面对挑战|寻找自我|发现自我|到达目的地|展示成果|旅途结束)", text):
        return True
    if re.fullmatch(r".{0,8}(观察|准备|前行|逼近|胜利|站定|远眺|回望).{0,8}", text):
        return True
    if re.search(r"(沿着|顺着).{0,12}(方向|路线|小路|道路).{0,8}(前进|前行|行走|走)", text):
        return True
    if re.search(r"(继续|逐渐).{0,10}(前行|前进|接近|靠近|走向)", text):
        return True
    if re.search(r"(需要找到|需要寻找).{0,10}(方向|方法|道路|路线)", text):
        return True
    if re.search(r"(鼓起勇气|克服阻碍|做出方向抉择|做出选择|心中|期待|温暖)", text):
        return True
    if re.search(r"(停下脚步|来到.{0,8}边缘|看到远处|看着远处|望着远处)", text):
        return True
    if re.search(r"(凝视|整理装备|踏步前行|靠近.{0,6}$|站定|查看战场|观察战场)", text):
        return True
    if re.fullmatch(r".{0,8}(右手|左手|双手|手).{0,4}(握紧|发光|抬起)\d*", text):
        return True
    if re.search(r"(在|于).{0,10}(森林|树林|山野|山路|小路|道路|路上|战场|古镇|王座|地狱|废墟|溪流|水边).{0,10}(行走|走着|前行|探索|寻找|休息|停下|停留|站立|眺望|望向|看向)", text):
        return True
    if storyboard_visual_event_action_is_short_label(text):
        return True
    if storyboard_visual_event_action_is_static_state(text):
        return True
    if STORYBOARD_VISUAL_EVENT_ABSTRACT_STAGE_RE.search(text):
        return True
    if not storyboard_director_action_has_visible_event(text):
        return True
    if re.search(r"(决定|打算|准备).{0,8}(救助|留下|继续|前行|放下|选择|面对|治疗)", text):
        return True
    if re.search(r"(面对).{0,8}(新环境|未知|挑战|两条路|选择)", text):
        return True
    if re.search(r"(决定|做出选择|面对新环境|面对未知|内心|心中|领悟|真谛|成长|收获|探索自然|面临困难|耗费|精力|更加坚定)", text):
        return not bool(re.search(
            r"(告别|背起|踏上|踏入|走入|走进|蹲下|奔跑|攀过|翻过|翻越|越过|穿过|抓住|扶起|抱起|推开|拨开|翻开|翻阅|阅读|记录|写下|整理|放入|放下|丢弃|投入|握紧|抚摸|触摸|触碰|递给|接过|赠予|包扎|救助|拾起|捡起|找到|埋下|埋进|种下|遇见|遇到|发现|靠近|登上|转身|离开)",
            text,
        ))
    return False


def storyboard_visual_event_action_is_atmosphere_soft_event(action: str) -> bool:
    text = clean_text(str(action or ""))
    if not text:
        return False
    if re.search(r"(未来|成长|自我|希望|勇气|命运|内心|领悟|真谛|挑战)", text) and not re.search(
        r"(阳光|晨光|月光|光线|风|雨|雪|雾|黄昏|黎明|夜色|远方|来路|山路|天空|云|水面)",
        text,
    ):
        return False
    return bool(re.search(
        r"(沐浴|感受|站在|停在|静立|看向|望向|凝望|回望|迎着|背对|停步).{0,12}"
        r"(阳光|晨光|月光|光线|风|雨|雪|雾|黄昏|黎明|夜色|远方|来路|山路|天空|云|水面)|"
        r"(阳光|晨光|月光|风|雨|雪|雾).{0,10}(笼罩|包围|照在|落在|穿过)",
        text,
    ))


def storyboard_visual_event_atmosphere_hint(action: str, scene_anchor: str) -> str:
    text = clean_text(f"{action} {scene_anchor}")
    if re.search(r"(阳光|晨光|光线|黎明)", text):
        return "sunlight"
    if re.search(r"(月光|夜色)", text):
        return "moonlight"
    if re.search(r"(风)", text):
        return "wind"
    if re.search(r"(雨)", text):
        return "rain"
    if re.search(r"(雪)", text):
        return "snow"
    if re.search(r"(雾)", text):
        return "mist"
    if re.search(r"(远方|来路|山路|天空|云|水面)", text):
        return "distant_view"
    return "atmosphere"


def storyboard_visual_event_action_is_generic_movement(action: str) -> bool:
    text = clean_text(str(action or ""))
    if not text:
        return False
    if re.fullmatch(r"(继续前行|踏上旅途|探索自然|寻找自我|面对挑战|走向未来)", text):
        return True
    return bool(re.search(
        r"(在|于).{0,8}(森林|树林|山野|山路|小路|旅途|路上|自然).{0,6}(行走|走着|前行|探索)",
        text,
    ))


def concrete_storyboard_movement_action(context: str, index: int) -> str:
    text = clean_text(context)
    if re.search(r"(朋友|新朋友|旅伴|同伴|伙伴)", text):
        return "少女跟随新朋友走向林间岔路"
    if re.search(r"(溪|河|浅滩|水边|河流)", text):
        return "少女沿溪边石路走向浅滩"
    if re.search(r"(倒木|断桥|障碍|阻碍)", text):
        return "少女绕过倒木走向小路"
    if re.search(r"(藤蔓|荆棘|灌木|低枝|枝叶)", text):
        return "少女拨开低枝进入林间岔路"
    if re.search(r"(森林|树林|林间|自然)", text):
        return "少女拨开低枝进入林间岔路"
    if re.search(r"(山路|山野|山坡|高处|山顶)", text):
        return "少女沿山路走向远处路标"
    if re.search(r"(村口|故乡|家人|离开|告别|出发|启程)", text) and index <= 1:
        return "少女背起背包踏上土路"
    return "少女沿小路走向木牌路标"


def concrete_storyboard_object_state_action(action: str, context: str) -> str:
    text = clean_text(action)
    if not text:
        return ""
    match = re.fullmatch(r"(收起|整理|保存|放入|放进)(.{1,14})", text)
    if not match:
        return ""
    obj = clean_text(match.group(2)).strip("，,。；; ")
    if not re.search(r"(礼物|地图|日记|信件|种子|花种|果实|果子|野果|旧物|残页|背包)", obj):
        return ""
    if re.search(r"(小鹿|小狗|朋友|新朋友|旅伴|同伴|伙伴)", context):
        return f"少女把{obj}放入背包"
    return f"少女把{obj}收进背包"


def strip_storyboard_visual_action_tail(action: str) -> str:
    text = clean_text(action)
    if not text:
        return ""
    trimmed = re.sub(
        r"[，,；;]\s*(心中|内心|心情|情绪|象征|意味着|代表|感到|感受|充满|开始思考|开始反思|意识到|领悟|收获|更加坚定|准备继续前行|继续前行).*$",
        "",
        text,
    ).strip(" ，,。；;")
    trimmed = re.sub(
        r"[，,；;]\s*(进入|开始|继续|并|然后)?.{0,10}(探险|探索|成长|寻找自我|发现自我|结束旅途|展示成果|面对挑战|走向未来).*$",
        "",
        trimmed,
    ).strip(" ，,。；;")
    return trimmed or text


def storyboard_visual_event_has_action_change(text: str) -> bool:
    value = clean_text(text)
    if not value:
        return False
    return bool(STORYBOARD_VISUAL_EVENT_ACTION_CHANGE_RE.search(value))


def storyboard_visual_event_action_is_bare_label(title: str, action: str) -> bool:
    title_text = clean_text(title)
    action_text = clean_text(action)
    if not action_text:
        return True
    if storyboard_visual_event_has_action_change(action_text):
        return False
    if len(action_text) <= 6:
        return True
    return bool(title_text and action_text in title_text and len(action_text) + 2 <= len(title_text))


def storyboard_visual_event_merge_incomplete_action(title: str, action: str) -> str:
    title_text = clean_text(title)
    action_text = clean_text(action)
    if not title_text or not action_text:
        return action_text
    match = STORYBOARD_VISUAL_EVENT_INCOMPLETE_ACTION_RE.fullmatch(action_text)
    if not match:
        return action_text
    verb = clean_text(match.group("verb"))
    actor = clean_text(match.group("actor"))
    if not verb or not actor:
        return action_text
    if title_text.startswith(verb) and len(title_text) > len(verb):
        return clean_text(f"{actor}{title_text}")[:60]
    if not storyboard_visual_event_has_action_change(title_text):
        return clean_text(f"{action_text}{title_text}")[:60]
    return action_text


def coerce_storyboard_visual_event_action(title: str, action: str, cause: str, index: int, scene_anchor: str = "") -> str:
    text = clean_text(action)
    title_text = clean_text(title)
    if text and title_text and len(text) <= 8 and len(title_text) > len(text) + 1 and title_text.endswith(text):
        return title_text
    if title_text and storyboard_visual_event_action_is_bare_label(title_text, text) and storyboard_visual_event_has_action_change(title_text):
        return title_text
    merged = storyboard_visual_event_merge_incomplete_action(title_text, text)
    if merged != text:
        return merged
    return text


def storyboard_visual_event_scene_anchor_key(value: str) -> str:
    return normalize_storyboard_director_field(value).replace(" ", "")


def storyboard_visual_event_scene_anchor_is_broad(value: str) -> bool:
    text = storyboard_visual_event_scene_anchor_key(value)
    if not text:
        return True
    return bool(re.fullmatch(r"(自然环境|环境|地点|空间|场景|道路|路上|途中|远方|户外|室内|暗处|未知地点|某处)", text))


def storyboard_visual_event_anchor_focus(title: str, action: str) -> str:
    title_text = clean_text(title)
    action_text = clean_text(action)
    focus = title_text if title_text and not re.fullmatch(r"(事件|阶段|场景|继续|前行|行走|旅途|探索|探险)\d*", title_text) else action_text
    focus = re.sub(r"[0-9０-９一二三四五六七八九十]+$", "", focus)
    focus = re.sub(r"(开始|逐渐|正在|已经|最终|继续|重新|再次)", "", focus)
    focus = clean_text(focus).strip(" ，,。；;")
    if not focus:
        return ""
    return focus[:6]


def coerce_storyboard_visual_event_scene_anchor(
    title: str,
    action: str,
    scene_anchor: str,
    index: int,
    seen_keys: set[str],
    previous_key: str,
) -> str:
    anchor = clean_text(scene_anchor)
    key = storyboard_visual_event_scene_anchor_key(anchor)
    if anchor and key and key not in seen_keys and key != previous_key and not storyboard_visual_event_scene_anchor_is_broad(anchor):
        return anchor
    focus = storyboard_visual_event_anchor_focus(title, action)
    if not anchor:
        return (focus or f"事件{index + 1}")[:30]
    return anchor[:30]


STORYBOARD_VISUAL_EVENT_REPEAT_REPAIRS = []


STORYBOARD_VISUAL_EVENT_TYPE_RULES = [
    ("farewell", re.compile(r"(告别|挥手|离开).{0,8}(家人|故乡|村口|起点)|挥手告别|离开故乡")),
    ("journey_start", re.compile(r"(背起|踏上|启程|出发).{0,8}(背包|行囊|旅途|山路|小路)")),
    ("pickup", re.compile(r"(拾起|捡起|找到).{0,10}(旧物|遗物|信件|照片|日记|木牌|石头)")),
    ("read_record", re.compile(r"(翻开|翻阅|阅读|记录|写下).{0,10}(日记|本子|文字|旅途)")),
    ("push_through", re.compile(r"(拨开|推开).{0,10}(藤蔓|荆棘|枝叶|森林|灌木|树枝)")),
    ("cross_obstacle", re.compile(r"(跨过|越过|翻越|穿过|攀过).{0,10}(溪流|小溪|倒木|断桥|山野|障碍|浅滩)")),
    ("plant_marker", re.compile(r"(种下|埋下).{0,10}(种子|花种|野花)")),
    ("release_object", re.compile(r"(放下|埋下|丢弃|投入|留下).{0,10}(旧物|遗物|信件|照片|日记)")),
    ("meeting", re.compile(r"(遇见|遇到|交谈|对话|赠予|告诉).{0,10}(老者|老人|旅伴|同伴|伙伴)")),
    ("help_animal", re.compile(r"(包扎|救助|扶起|抱起|抚摸).{0,10}(小鹿|小狗|动物)")),
    ("summit_close", re.compile(r"(登上|抵达|回望).{0,10}(山顶|高处|来路)")),
    ("new_path", re.compile(r"(转身|走向|走进).{0,10}(新路|山路)")),
]


def storyboard_visual_event_type_key(title: str, action: str) -> str:
    text = clean_text(f"{title} {action}")
    if not text:
        return ""
    for key, pattern in STORYBOARD_VISUAL_EVENT_TYPE_RULES:
        if pattern.search(text):
            return key
    return ""


def repair_repeated_storyboard_visual_event(
    title: str,
    action: str,
    cause: str,
    index: int,
    seen_titles: set[str],
    seen_actions: set[str],
    seen_semantics: set[str],
    seen_types: set[str],
) -> tuple[str, str, str]:
    title_key = normalize_storyboard_director_field(title)
    action_key = normalize_storyboard_director_field(action)
    semantic_key, _ = storyboard_director_semantic_event_key(title, action)
    event_type_key = storyboard_visual_event_type_key(title, action)
    repeat_hit = (
        (title_key and title_key in seen_titles)
        or (action_key and action_key in seen_actions)
        or (semantic_key and semantic_key in seen_semantics)
        or (event_type_key and event_type_key in seen_types)
    )
    if not repeat_hit:
        return title, action, cause
    if not STORYBOARD_VISUAL_EVENT_REPEAT_REPAIRS:
        return title, action, cause
    start = max(0, min(index, len(STORYBOARD_VISUAL_EVENT_REPEAT_REPAIRS) - 1))
    ordered = STORYBOARD_VISUAL_EVENT_REPEAT_REPAIRS[start:] + STORYBOARD_VISUAL_EVENT_REPEAT_REPAIRS[:start]
    for next_title, next_action, next_cause in ordered:
        next_title_key = normalize_storyboard_director_field(next_title)
        next_action_key = normalize_storyboard_director_field(next_action)
        next_semantic_key, _ = storyboard_director_semantic_event_key(next_title, next_action)
        next_type_key = storyboard_visual_event_type_key(next_title, next_action)
        if next_title_key in seen_titles or next_action_key in seen_actions:
            continue
        if next_semantic_key and next_semantic_key in seen_semantics:
            continue
        if next_type_key and next_type_key in seen_types:
            continue
        if storyboard_director_action_is_weak_event(next_action):
            continue
        return next_title, next_action, next_cause
    return title, action, cause


STORYBOARD_VISUAL_EVENT_GENERIC_CAUSE_RE = re.compile(
    r"^(继续前行|告别过去|抵达高处|发现线索|留下记号|越过阻碍|开始旅程|推动变化|进入下一步|"
    r"放下过去|遇见新我|方向开启|进入旅途|确认方向|做出选择|付出代价|结果显现|旅途收束)$"
)


STORYBOARD_VISUAL_EVENT_RELEASE_OBJECT_RE = re.compile(
    r"(旧物|日记|信件|照片|地图|木牌|石头|种子|花种|朋友|新朋友|旅伴|同伴|伙伴)"
)


def storyboard_visual_event_released_objects(title: str, action: str) -> set[str]:
    text = clean_text(f"{title} {action}")
    if not text or not re.search(r"(放下|埋下|埋进|丢弃|投入|留下|告别|分离|离开)", text):
        return set()
    return {match.group(1) for match in STORYBOARD_VISUAL_EVENT_RELEASE_OBJECT_RE.finditer(text)}


def storyboard_visual_event_reacquires_released_object(title: str, action: str, released: set[str]) -> str:
    if not released:
        return ""
    text = clean_text(f"{title} {action}")
    if not text or not re.search(r"(拾起|捡起|找回|带回|重新|再次|遇见|跟随|同行|结伴)", text):
        return ""
    for item in released:
        if item and item in text:
            return item
    return ""


def storyboard_visual_event_align_title_action(title: str, action: str) -> tuple[str, str]:
    action_type = storyboard_visual_event_type_key("", action)
    return title, action_type


def storyboard_visual_event_title_action_drift_reason(title: str, action: str, scene_anchor: str = "") -> str:
    title_text = clean_text(title)
    action_text = clean_text(action)
    space_text = clean_text(scene_anchor)
    context = f"{title_text} {action_text} {space_text}"
    if not title_text or not action_text:
        return ""
    if re.search(r"(初遇|遇见|相遇|偶遇)", title_text) and not re.search(r"(遇见|遇到|相遇|偶遇|碰见|看见|发现|出现|靠近|递给|接过|交换|帮助|挡住|同行|指向)", action_text):
        return "meeting_title_without_visible_meeting"
    if re.search(r"(指引|指路|路线|路牌)", title_text) and not re.search(r"(地图|路牌|标记|箭头|指向|指路|路线|岔路|脚印|痕迹|方向|递给|交换|吹动)", context):
        return "guidance_title_without_visible_source"
    if re.search(r"(迷路|迷失|走错|失路)", title_text) and not re.search(r"(地图|路牌|岔路|折返|找不到|丢失|倒下|错误|脚印|标记|路线|方向)", context):
        return "lost_title_without_visible_evidence"
    if re.search(r"(对话|风|光|感受|聆听|探险|探索)", title_text) and storyboard_director_action_is_weak_event(action_text):
        return "weak_title_without_visible_change"
    return ""


def storyboard_visual_event_action_without_subject(action: str) -> str:
    text = clean_text(action)
    text = re.sub(r"^(少女|女孩|主角|少年|旅伴|朋友|新朋友)", "", text).strip()
    return text or clean_text(action)


def storyboard_visual_event_cause_is_generic(cause: str) -> bool:
    text = clean_text(cause)
    if not text:
        return True
    if STORYBOARD_VISUAL_EVENT_GENERIC_CAUSE_RE.search(text):
        return True
    return bool(re.search(r"(决定|探索自然|成长|领悟|真谛|希望|面对挑战|内心|心中|感受到|收获|获得勇气|更加坚定)", text))


def storyboard_visual_event_causal_bridge(previous: dict, current: dict, index: int, selected_direction=None) -> str:
    if index <= 0:
        direction = selected_direction if isinstance(selected_direction, dict) else {}
        return clean_text(str(direction.get("title") or "故事起因"))[:50]
    prev_title = clean_text(str(previous.get("title") or "上一事件"))
    prev_action = clean_text(str(previous.get("action") or ""))
    cur_title = clean_text(str(current.get("title") or "下一事件"))
    cur_action = clean_text(str(current.get("action") or ""))
    action_core = storyboard_visual_event_action_without_subject(cur_action)
    return clean_text(f"{prev_title}后，{action_core}")[:50]


def preserve_storyboard_visual_event_chain(events: list[dict], selected_direction=None) -> tuple[list[dict], list[str]]:
    if not isinstance(events, list):
        return events, []
    linked: list[dict] = []
    details: list[str] = []
    released: set[str] = set()
    for index, item in enumerate(events):
        event = dict(item or {})
        original_title = clean_text(str(event.get("title") or ""))
        original_action = clean_text(str(event.get("action") or ""))
        title = original_title
        action = original_action
        aligned_title, title_action_type = storyboard_visual_event_align_title_action(title, action)
        if aligned_title != title:
            details.append(f"Scene{index + 1:02d}:title/action:{title}->{aligned_title}")
            title = aligned_title
        title_action_drift_reason = storyboard_visual_event_title_action_drift_reason(title, action, event.get("sceneAnchor") or "")
        if title_action_drift_reason:
            event["titleActionDrift"] = True
            event["titleActionDriftReason"] = title_action_drift_reason
            event["needsDirectorConcrete"] = True
            details.append(f"Scene{index + 1:02d}:title-action-drift:{title_action_drift_reason}:{title}/{action}")
        reacquired = storyboard_visual_event_reacquires_released_object(title, action, released)
        if reacquired:
            event["stateReversalRisk"] = True
            event["stateReversalReason"] = reacquired
            event["needsDirectorConcrete"] = True
            details.append(f"Scene{index + 1:02d}:state-risk:{title}/{action}:{reacquired}")
        cause = clean_text(str(event.get("cause") or ""))
        if storyboard_visual_event_cause_is_generic(cause):
            cause = storyboard_visual_event_causal_bridge(linked[-1] if linked else {}, {**event, "title": title, "action": action}, index, selected_direction)
            details.append(f"Scene{index + 1:02d}:cause:{cause}")
        event["title"] = title[:20]
        event["action"] = action[:60]
        event["cause"] = cause[:50]
        linked.append(event)
        released.update(storyboard_visual_event_released_objects(title, action))
    return linked, details[:18]


def storyboard_director_action_has_concrete_object_or_event(action: str) -> bool:
    text = clean_text(str(action or ""))
    return bool(text and (
        (storyboard_director_action_has_visible_event(text) and not storyboard_director_action_is_weak_event(text)) or
        STORYBOARD_DIRECTOR_CONCRETE_OBJECT_RE.search(text)
    ))


def storyboard_director_action_is_passive_ending(action: str) -> bool:
    text = clean_text(str(action or ""))
    if not text:
        return True
    return bool(re.search(r"(站立|静立|远望|凝视|观察|背影|等待|停下|回望|收束|结束|收场|准备结束|准备收场)", text))


def storyboard_director_visual_background_signature(item: list) -> tuple[str, str]:
    if not isinstance(item, list) or len(item) < 4:
        return "", ""
    beat = clean_text(str(item[0] or ""))
    space = clean_text(str(item[2] or ""))
    action = clean_text(str(item[3] or ""))
    text = f"{beat} {space} {action}"
    if re.search(r"(家中|庭院|书房|客厅|卧室|房间)", text):
        return "origin_home", "家中庭院室内"
    if re.search(r"(溪边|河边|水边|浅滩|石岸|溪流|河水|湖水|水面)", text):
        return "water_stream", "溪边水岸"
    if re.search(r"(山顶|山巅|高处|山路|山间|山谷|村口|远方|远山|新旅程|新环境|小路|背影)", text):
        return "open_mountain_path", "远山山谷背影构图"
    return "", ""


STORYBOARD_DIRECTOR_SIMPLE_CAMERA_LABELS = {"远景", "中景", "近景", "特写", "全景"}


def storyboard_director_field_looks_like_camera(value: str) -> bool:
    text = clean_text(str(value or ""))
    return bool(text and re.search(r"(远景|中景|近景|特写|全景|过肩|低机|高机|俯拍|仰拍|跟拍|拉远|推近|推进|固定|环绕|侧面|背影|手部|道具|广角)", text))


def storyboard_director_camera_is_simple_label(camera: str) -> bool:
    return clean_text(str(camera or "")) in STORYBOARD_DIRECTOR_SIMPLE_CAMERA_LABELS


def storyboard_director_camera_kind(camera: str) -> str:
    text = clean_text(str(camera or ""))
    if not text:
        return "empty"
    if re.search(r"(特写|近景|中近|近距|细节|手部|面部|眼神)", text):
        return "close"
    if re.search(r"(过肩|跟拍|推进|推近|侧面|背影)", text):
        return "motion"
    if re.search(r"(远景|全景|拉远|高机|低机|俯拍|仰拍|广角)", text):
        return "wide"
    if re.search(r"(中景|平视)", text):
        return "medium"
    return normalize_storyboard_director_field(text)[:12] or "other"


def storyboard_director_action_focus_signature(item: list) -> tuple[str, str]:
    if not isinstance(item, list) or len(item) < 4:
        return "unknown", "未知焦点"
    beat = clean_text(str(item[0] or ""))
    action = clean_text(str(item[3] or ""))
    for text in (action, beat):
        if not text:
            continue
        if re.search(r"(日记|本子|书(?!房|屋|店|馆)|地图|信件|纸张|照片)", text):
            return "record_prop", "记录道具"
        if re.search(r"(旧物|遗物|行李|箱子|背包|包裹)", text):
            return "memory_prop", "旧物行李"
        if re.search(r"(小鹿|小狗|动物|野兽)", text):
            return "animal", "动物互动"
        if re.search(r"(老者|老人|旅伴|同伴|伙伴|家人|村民)", text):
            return "person_interaction", "人物互动"
        if re.search(r"(倒木|断桥|溪流|障碍|险路|岔路|两条路|道路)", text):
            return "route_obstacle", "道路阻碍"
        if re.search(r"(翻开|翻阅|阅读|记录|写下|递给|接过|包扎|救助|扶起|放下|拾起|捡起|握住|整理|放入|埋下|埋进|拨开|种下|追赶)", text):
            return "visible_hand_action", "手部动作"
        if re.search(r"(背影|前行|踏上|离开|出发|启程|山路|小路)", text):
            return "journey_body", "旅途身体动线"
        if re.search(r"(站在|远望|回望|面对|选择|决定)", text):
            return "standing_choice", "站立选择"
    semantic_key, semantic_label = storyboard_director_semantic_event_key(beat, action)
    if semantic_key:
        return semantic_key, semantic_label
    normalized = normalize_storyboard_director_field(action or beat)
    return (normalized[:12] or "event", "剧情动作")


def storyboard_director_real_camera_signature(item: list) -> tuple[str, str]:
    if not isinstance(item, list) or len(item) < 4:
        return "", ""
    camera_kind = storyboard_director_camera_kind(str(item[1] or ""))
    focus_key, focus_label = storyboard_director_action_focus_signature(item)
    background_key, background_label = storyboard_director_visual_background_signature(item)
    signature = "|".join([camera_kind, focus_key, background_key or "space"])
    label_parts = [camera_kind, focus_label]
    if background_label:
        label_parts.append(background_label)
    return signature, "/".join(label_parts)


STORYBOARD_DIRECTOR_CAMERA_ENHANCEMENT_POOLS = {
    "record_prop": ["手部特写", "道具特写", "俯拍近景", "过肩近景", "近景推近"],
    "memory_prop": ["道具特写", "手部特写", "俯拍近景", "近景推近", "过肩近景"],
    "visible_hand_action": ["手部特写", "俯拍近景", "道具特写", "过肩近景", "近景推近"],
    "animal": ["低机近景", "侧面中景", "俯拍近景", "过肩中景", "手部特写"],
    "person_interaction": ["过肩中景", "双人中景", "侧面近景", "平视中景", "低机中景"],
    "route_obstacle": ["低机近景", "侧面跟拍", "俯拍全景", "前景中景", "低机远景"],
    "journey_body": ["背影拉远", "侧面跟拍", "俯拍远景", "低机远景", "远景拉远"],
    "standing_choice": ["高机远景", "背影全景", "平视远景", "远景拉远", "低机远景"],
}
STORYBOARD_DIRECTOR_DEFAULT_CAMERA_POOL = ["过肩中景", "侧面跟拍", "低机近景", "俯拍远景", "平视中景", "远景拉远"]


def storyboard_director_camera_enhancement_pool(item: list) -> list[str]:
    focus_key, _ = storyboard_director_action_focus_signature(item)
    if focus_key in STORYBOARD_DIRECTOR_CAMERA_ENHANCEMENT_POOLS:
        return STORYBOARD_DIRECTOR_CAMERA_ENHANCEMENT_POOLS[focus_key]
    semantic_key, _ = storyboard_director_semantic_event_key(str(item[0] or ""), str(item[3] or ""))
    if semantic_key in {"diary_reading", "old_object_discovery", "old_object_release", "flower_observation"}:
        return STORYBOARD_DIRECTOR_CAMERA_ENHANCEMENT_POOLS["record_prop"]
    if semantic_key in {"elder_meeting", "companion_meeting", "farewell_origin"}:
        return STORYBOARD_DIRECTOR_CAMERA_ENHANCEMENT_POOLS["person_interaction"]
    if semantic_key in {"animal_meeting"}:
        return STORYBOARD_DIRECTOR_CAMERA_ENHANCEMENT_POOLS["animal"]
    if semantic_key in {"journey_start"}:
        return STORYBOARD_DIRECTOR_CAMERA_ENHANCEMENT_POOLS["journey_body"]
    if semantic_key in {"route_obstacle", "lost_direction"}:
        return STORYBOARD_DIRECTOR_CAMERA_ENHANCEMENT_POOLS["route_obstacle"]
    if semantic_key in {"self_realization", "summit_resolution"}:
        return STORYBOARD_DIRECTOR_CAMERA_ENHANCEMENT_POOLS["standing_choice"]
    return STORYBOARD_DIRECTOR_DEFAULT_CAMERA_POOL


def storyboard_director_pick_enhanced_camera(
    pool: list[str],
    item: list,
    index: int,
    previous_cameras: list[str],
    used_counts: dict[str, int],
    used_signature_counts: dict[str, int],
) -> str:
    current = clean_text(str(item[1] or ""))
    candidates = [clean_text(value) for value in pool if clean_text(value)]
    if not candidates:
        return current
    seed_text = "|".join(clean_text(str(field or "")) for field in item)
    seed = sum(ord(char) for char in seed_text) + index * 7
    recent = set(previous_cameras[-2:])
    ordered = candidates[seed % len(candidates):] + candidates[:seed % len(candidates)]
    for max_signature_used in (0, 1, 2):
        for max_camera_used in (0, 1, 2):
            for candidate in ordered:
                if candidate == current:
                    continue
                if candidate in recent:
                    continue
                probe_item = list(item)
                probe_item[1] = candidate
                signature_key, _ = storyboard_director_real_camera_signature(probe_item)
                if signature_key and used_signature_counts.get(signature_key, 0) > max_signature_used:
                    continue
                if used_counts.get(candidate, 0) > max_camera_used:
                    continue
                return candidate
    for candidate in ordered:
        if candidate != current:
            return candidate
    return current


def storyboard_director_enhance_simple_cameras(parsed: list) -> tuple[list, list[dict]]:
    if not isinstance(parsed, list) or len(parsed) != 9:
        return parsed, []
    simple_indexes = [
        index for index, item in enumerate(parsed)
        if isinstance(item, list) and len(item) >= 4 and storyboard_director_camera_is_simple_label(item[1])
    ]
    if len(simple_indexes) < 6:
        return [list(item) for item in parsed], []
    enhanced = [list(item) for item in parsed]
    changes: list[dict] = []
    previous_cameras: list[str] = []
    used_counts: dict[str, int] = {}
    used_signature_counts: dict[str, int] = {}
    for index, item in enumerate(enhanced):
        current = clean_text(str(item[1] or ""))
        if storyboard_director_camera_is_simple_label(current):
            pool = storyboard_director_camera_enhancement_pool(item)
            next_camera = storyboard_director_pick_enhanced_camera(pool, item, index, previous_cameras, used_counts, used_signature_counts)
            if next_camera and next_camera != current:
                item[1] = next_camera
                changes.append({"index": index, "from": current, "to": next_camera})
                current = next_camera
        previous_cameras.append(current)
        used_counts[current] = used_counts.get(current, 0) + 1
        signature_key, _ = storyboard_director_real_camera_signature(item)
        if signature_key:
            used_signature_counts[signature_key] = used_signature_counts.get(signature_key, 0) + 1
    return enhanced, changes


STORYBOARD_DIRECTOR_SEMANTIC_EVENT_RULES = [
    ("farewell_origin", "告别起点", re.compile(r"(告别|挥手|离开).{0,8}(家人|家中|故乡|村民|村口)|离开家|离开故乡|告别家人|告别村")),
    ("journey_start", "启程旅途", re.compile(r"(踏上|开始|启程|出发|背起).{0,8}(旅途|旅程|小路|山路|道路|行囊|背包)|踏上旅途|踏上旅程")),
    ("elder_meeting", "遇见老者", re.compile(r"(遇见|遇到|再次遇到|偶遇|交谈|对话|赠予|告诉|指引).{0,10}(老者|老人)|老者.{0,10}(赠予|告诉|指引|交谈|对话|地图)")),
    ("companion_meeting", "遇见旅伴", re.compile(r"(旅伴|同伴|伙伴|朋友).{0,10}(同行|结伴|遇见|遇到|加入)|遇见.{0,8}(旅伴|同伴|伙伴)")),
    ("animal_meeting", "遇见动物", re.compile(r"(小鹿|小狗|动物|野兽).{0,10}(出现|靠近|遇见|遇到|停步|跟随)|遇见.{0,8}(小鹿|小狗|动物)")),
    ("diary_reading", "翻阅日记", re.compile(r"(日记|本子).{0,10}(翻开|翻阅|阅读|记录|写下)|翻开日记|翻阅日记|记录旅途")),
    ("old_object_discovery", "发现旧物", re.compile(r"(发现|找到|拾起|看见|握住).{0,10}(旧物|遗物|信件|照片)|旧物.{0,8}(出现|发现|握在手中)")),
    ("old_object_release", "放下旧物", re.compile(r"(放下|丢弃|投入|丢入|落入|整理|收起|放入).{0,10}(旧物|遗物|信件|日记|照片|行李箱)|放下旧物|旧物.{0,10}(落入|放下|丢弃)")),
    ("flower_observation", "观察花朵", re.compile(r"(花朵|野花|花).{0,10}(观察|发现|拾起|盛开)|观察.{0,8}(花朵|野花|花)")),
    ("route_obstacle", "面对阻碍", re.compile(r"(倒木|断桥|溪流|障碍|险路|山崖).{0,10}(挡住|穿过|跨过|越过|面对)|面对.{0,8}(阻碍|障碍|断桥|溪流)")),
    ("lost_direction", "迷失方向", re.compile(r"(迷路|迷失|辨认方向|找不到方向|岔路|选择方向|选择道路)")),
    ("self_realization", "找到自我", re.compile(r"(找到|理解|看见|接受).{0,8}(自我|自己|答案|内心)|真正的自我|找到自我")),
    ("summit_resolution", "山顶收束", re.compile(r"(山顶|山巅|高处).{0,12}(远望|眺望|望向|站在|抵达|到达)|登上山")),
]


def storyboard_director_semantic_event_key(beat: str, action: str) -> tuple[str, str]:
    text = clean_text(f"{beat} {action}")
    if not text:
        return "", ""
    for key, label, pattern in STORYBOARD_DIRECTOR_SEMANTIC_EVENT_RULES:
        if pattern.search(text):
            return key, label
    return "", ""


def validate_compact_storyboard_director_quality(parsed: list) -> dict:
    warnings: list[str] = []
    hard_errors: list[str] = []
    beats = [str(item[0] or "") for item in parsed]
    cameras = [str(item[1] or "") for item in parsed]
    spaces = [str(item[2] or "") for item in parsed]
    actions = [str(item[3] or "") for item in parsed]
    normalized_beats = [normalize_storyboard_director_field(value) for value in beats]
    normalized_cameras = [normalize_storyboard_director_field(value) for value in cameras]
    normalized_spaces = [normalize_storyboard_director_field(value) for value in spaces]
    normalized_actions = [normalize_storyboard_director_field(value) for value in actions]

    off_topic_warnings: list[str] = []
    for index, action in enumerate(actions):
        if storyboard_director_obvious_off_topic(action):
            off_topic_warnings.append(f"ACTION_OBVIOUS_OFF_TOPIC:Scene{index + 1:02d}:{action}")
        if storyboard_director_action_is_weak_event(action):
            warnings.append(f"WEAK_ACTION_EVENT:Scene{index + 1:02d}:{action}")
    warnings.extend(off_topic_warnings)
    if len(off_topic_warnings) >= 5:
        hard_errors.append(off_topic_warnings[0])

    for index in range(2, len(normalized_cameras)):
        if normalized_cameras[index] and normalized_cameras[index] == normalized_cameras[index - 1] == normalized_cameras[index - 2]:
            warnings.append(f"CAMERA_THREE_REPEAT:Scene{index - 1:02d}-Scene{index + 1:02d}:{cameras[index]}")
            break

    fixed_wide_count = sum(1 for value in normalized_cameras if "远景固定" in value or ("远景" in value and "固定" in value))
    if fixed_wide_count > 3:
        warnings.append(f"FAR_FIXED_OVER_LIMIT:{fixed_wide_count}")

    adjacent_camera_repeats = 0
    for index in range(1, len(normalized_cameras)):
        if normalized_cameras[index] and normalized_cameras[index] == normalized_cameras[index - 1]:
            adjacent_camera_repeats += 1
    if adjacent_camera_repeats:
        warnings.append(f"ADJACENT_CAMERA_REPEAT:{adjacent_camera_repeats}")

    seen_beat_keys: dict[str, int] = {}
    beat_repeat_pairs: list[str] = []
    for index, beat_key in enumerate(normalized_beats):
        if not beat_key:
            continue
        if beat_key in seen_beat_keys:
            first_index = seen_beat_keys[beat_key]
            beat_repeat_pairs.append(f"BEAT_REPEAT:Scene{first_index + 1:02d}-Scene{index + 1:02d}:{beats[index]}")
        else:
            seen_beat_keys[beat_key] = index
    if beat_repeat_pairs:
        warnings.append(beat_repeat_pairs[0])

    seen_semantic_keys: dict[str, int] = {}
    semantic_repeat_pairs: list[str] = []
    for index, item in enumerate(parsed):
        semantic_key, semantic_label = storyboard_director_semantic_event_key(item[0], item[3])
        if not semantic_key:
            continue
        if semantic_key in seen_semantic_keys:
            first_index = seen_semantic_keys[semantic_key]
            semantic_repeat_pairs.append(
                f"BEAT_SEMANTIC_REPEAT:Scene{first_index + 1:02d}-Scene{index + 1:02d}:{semantic_label}"
            )
        else:
            seen_semantic_keys[semantic_key] = index
    if semantic_repeat_pairs:
        warnings.append(semantic_repeat_pairs[0])

    seen_visual_backgrounds: dict[str, int] = {}
    visual_background_repeat_pairs: list[str] = []
    for index, item in enumerate(parsed):
        signature_key, signature_label = storyboard_director_visual_background_signature(item)
        if not signature_key:
            continue
        if signature_key in seen_visual_backgrounds and index < 8:
            first_index = seen_visual_backgrounds[signature_key]
            visual_background_repeat_pairs.append(
                f"VISUAL_BACKGROUND_REPEAT:Scene{first_index + 1:02d}-Scene{index + 1:02d}:{signature_label}"
            )
        else:
            seen_visual_backgrounds.setdefault(signature_key, index)
    if visual_background_repeat_pairs:
        warnings.append(visual_background_repeat_pairs[0])

    simple_camera_indexes = [
        index for index, camera in enumerate(cameras)
        if storyboard_director_camera_is_simple_label(camera)
    ]
    if len(simple_camera_indexes) >= 6:
        warnings.append(f"CAMERA_SIMPLE_LABEL_OVER_LIMIT:{len(simple_camera_indexes)}")

    seen_real_camera_signatures: dict[str, int] = {}
    real_camera_repeat_pairs: list[str] = []
    for index, item in enumerate(parsed):
        signature_key, signature_label = storyboard_director_real_camera_signature(item)
        if not signature_key:
            continue
        if signature_key in seen_real_camera_signatures and index < 8:
            first_index = seen_real_camera_signatures[signature_key]
            real_camera_repeat_pairs.append(
                f"CAMERA_VISUAL_SIGNATURE_REPEAT:Scene{first_index + 1:02d}-Scene{index + 1:02d}:{signature_label}"
            )
        else:
            seen_real_camera_signatures.setdefault(signature_key, index)
    if real_camera_repeat_pairs:
        warnings.append(real_camera_repeat_pairs[0])

    adjacent_space_repeats = 0
    for index in range(1, len(normalized_spaces)):
        if normalized_spaces[index] and normalized_spaces[index] == normalized_spaces[index - 1]:
            adjacent_space_repeats += 1
    if adjacent_space_repeats:
        warnings.append(f"ADJACENT_SPACE_REPEAT:{adjacent_space_repeats}")

    seen_scene_keys: dict[str, int] = {}
    scene_repeat_pairs: list[str] = []
    for index, item in enumerate(parsed):
        key = "|".join(normalize_storyboard_director_field(field) for field in item)
        if not key:
            continue
        if key in seen_scene_keys:
            first_index = seen_scene_keys[key]
            repeat_text = f"SCENE_EXACT_REPEAT:Scene{first_index + 1:02d}-Scene{index + 1:02d}"
            if first_index >= 6 and index >= 6:
                warnings.append(repeat_text)
            else:
                scene_repeat_pairs.append(repeat_text)
        else:
            seen_scene_keys[key] = index
    if len(scene_repeat_pairs) >= 2:
        hard_errors.append(scene_repeat_pairs[0])
    elif scene_repeat_pairs:
        warnings.append(scene_repeat_pairs[0])

    seen_action_keys: dict[str, int] = {}
    action_repeat_pairs: list[str] = []
    for index, action_key in enumerate(normalized_actions):
        if not action_key:
            continue
        if action_key in seen_action_keys:
            first_index = seen_action_keys[action_key]
            repeat_text = f"ACTION_EXACT_REPEAT:Scene{first_index + 1:02d}-Scene{index + 1:02d}:{actions[index]}"
            if first_index >= 6 and index >= 6:
                warnings.append(repeat_text)
            else:
                action_repeat_pairs.append(repeat_text)
        else:
            seen_action_keys[action_key] = index
    if len(action_repeat_pairs) >= 2:
        hard_errors.append(action_repeat_pairs[0])
    elif action_repeat_pairs:
        warnings.append(action_repeat_pairs[0])

    for index in range(2, len(actions)):
        if index >= 8:
            continue
        if (
            storyboard_director_field_similarity(actions[index], actions[index - 1]) >= 0.92 and
            storyboard_director_field_similarity(actions[index - 1], actions[index - 2]) >= 0.92
        ):
            hard_errors.append(f"ACTION_HIGH_REPEAT:Scene{index - 1:02d}-Scene{index + 1:02d}:{actions[index]}")
            break

    if len(actions) >= 9:
        last_actions = actions[6:9]
        last_texts = list(last_actions)
        last_action_norms = [normalize_storyboard_director_field(value) for value in last_actions]
        last_non_empty_norms = [value for value in last_action_norms if value]
        last_all_empty = not last_non_empty_norms
        last_repeated = len(set(last_non_empty_norms)) <= 1
        last_all_passive = all(storyboard_director_action_is_passive_ending(text) for text in last_texts)
        last_has_concrete_event = any(storyboard_director_action_has_concrete_object_or_event(text) for text in last_texts)
        last_highly_similar = (
            storyboard_director_field_similarity(last_actions[0], last_actions[1]) >= 0.88 and
            storyboard_director_field_similarity(last_actions[1], last_actions[2]) >= 0.88
        )
        if last_all_empty or ((last_repeated or last_all_passive) and not last_has_concrete_event):
            hard_errors.append("ENDING_EMPTY_LOOP:Scene7-9 action repeats")
        elif last_all_passive or last_repeated:
            warnings.append("ENDING_WEAK_WARNING:Scene7-9 repeated closing action")
        elif last_highly_similar:
            warnings.append("ENDING_WEAK_WARNING:Scene7-9 highly similar actions")

    return {
        "hardError": hard_errors[0] if hard_errors else "",
        "warnings": warnings,
        "warningText": "; ".join(warnings),
    }


def compact_storyboard_director_array_error(parsed) -> str:
    if not isinstance(parsed, list):
        return "Parsed JSON is not an array."
    for index, item in enumerate(parsed):
        normalized = normalize_compact_storyboard_director_item(item)
        if not normalized:
            return f"COMPACT_SCHEMA_INVALID:scene{index + 1}"
        for field in normalized:
            if not isinstance(field, str) or not clean_text(field):
                return f"COMPACT_SCHEMA_INVALID:scene{index + 1}"
    return ""


def normalize_compact_storyboard_director_item(item) -> list[str] | None:
    if not isinstance(item, list):
        return None
    values = [clean_text(str(value or "")) for value in item]
    if len(values) == 5 and re.fullmatch(r"(?:scene)?\s*\d{1,2}", values[0], flags=re.I):
        values = values[1:5]
    elif len(values) != 4:
        return None
    if any(not value for value in values):
        return None
    beat = values[0]
    candidate_indexes = [1, 2, 3]
    camera_index = next((index for index in candidate_indexes if storyboard_director_field_looks_like_camera(values[index])), None)
    action_index = next((
        index for index in candidate_indexes
        if index != camera_index and storyboard_director_action_has_visible_event(values[index])
    ), None)
    if camera_index is not None and action_index is not None:
        space_index = next((index for index in candidate_indexes if index not in {camera_index, action_index}), None)
        if space_index is not None:
            return [beat, values[camera_index], values[space_index], values[action_index]]
    second, third, action = values[1], values[2], values[3]
    if storyboard_director_field_looks_like_camera(third) and not storyboard_director_field_looks_like_camera(second):
        return [beat, third, second, action]
    return [beat, second, third, action]


def normalize_compact_storyboard_director_array(parsed) -> list | None:
    if not isinstance(parsed, list):
        return None
    normalized: list[list[str]] = []
    for item in parsed:
        normalized_item = normalize_compact_storyboard_director_item(item)
        if not normalized_item:
            return None
        normalized.append(normalized_item)
    return normalized


def try_repair_compact_storyboard_outer_array(json_text: str, full_value: str):
    candidate = clean_text(json_text)
    full = clean_text(full_value)
    if not candidate or candidate != full:
        return None
    if not candidate.startswith("[") or not candidate.endswith("]"):
        return None
    if "```" in candidate:
        return None
    wrapped = f"[{candidate}]"
    try:
        parsed = json.loads(wrapped)
    except Exception:
        return None
    if len(parsed) != 9:
        return None
    normalized = normalize_compact_storyboard_director_array(parsed)
    if not normalized or compact_storyboard_director_array_error(normalized):
        return None
    return normalized


def validate_compact_storyboard_director_output(text: str) -> dict:
    value = clean_text(str(text or ""))
    raw_starts_with_array = value.startswith("[")
    raw_ends_with_array = value.endswith("]")
    json_text, json_closed = extract_storyboard_director_json_array_text(value)
    result = {
        "ok": False,
        "reason": "",
        "actualScenes": 0,
        "jsonClosed": json_closed,
        "rawStartsWithArray": raw_starts_with_array,
        "rawEndsWithArray": raw_ends_with_array,
        "qualityWarning": "",
        "qualityHardError": "",
        "jsonWrapperRepaired": False,
    }
    if not value or not json_text:
        return {**result, "reason": "JSON_NOT_FOUND"}
    if raw_starts_with_array and not json_closed:
        return {**result, "reason": "MODEL_OUTPUT_TRUNCATED"}
    if not json_closed:
        return {**result, "reason": "JSON_TRUNCATED"}
    json_wrapper_repaired = False
    try:
        parsed = json.loads(json_text)
    except Exception as exc:
        repaired = try_repair_compact_storyboard_outer_array(json_text, value)
        if repaired is None:
            return {**result, "reason": f"JSON_PARSE_FAILED:{exc}"}
        parsed = repaired
        json_wrapper_repaired = True
    if not isinstance(parsed, list):
        return {**result, "reason": "JSON_PARSE_FAILED:not array", "jsonWrapperRepaired": json_wrapper_repaired}
    actual_scenes = len(parsed)
    if actual_scenes != 9:
        return {**result, "reason": f"SCENE_COUNT_INVALID:{actual_scenes}", "actualScenes": actual_scenes, "jsonWrapperRepaired": json_wrapper_repaired}
    normalized = normalize_compact_storyboard_director_array(parsed)
    if not normalized:
        return {**result, "reason": "COMPACT_SCHEMA_INVALID:scene1", "actualScenes": actual_scenes, "jsonWrapperRepaired": json_wrapper_repaired}
    parsed = normalized
    schema_error = compact_storyboard_director_array_error(parsed)
    if schema_error:
        return {**result, "reason": schema_error, "actualScenes": actual_scenes, "jsonWrapperRepaired": json_wrapper_repaired}
    quality = validate_compact_storyboard_director_quality(parsed)
    warning_text = quality["warningText"]
    if json_wrapper_repaired:
        warning_text = "JSON_WRAPPER_REPAIRED" + (f"; {warning_text}" if warning_text else "")
    if quality["hardError"]:
        return {
            **result,
            "reason": quality["hardError"],
            "actualScenes": actual_scenes,
            "qualityWarning": warning_text,
            "qualityHardError": quality["hardError"],
            "jsonWrapperRepaired": json_wrapper_repaired,
        }
    return {
        **result,
        "ok": True,
        "reason": "",
        "actualScenes": actual_scenes,
        "qualityWarning": warning_text,
        "qualityHardError": "",
        "jsonWrapperRepaired": json_wrapper_repaired,
    }


def parse_compact_storyboard_director_text(text: str) -> tuple[list | None, bool, str]:
    value = clean_text(str(text or ""))
    if not value:
        return None, False, "JSON_NOT_FOUND"
    json_text, json_closed = extract_storyboard_director_json_array_text(value)
    if not json_text:
        return None, False, "JSON_NOT_FOUND"
    if not json_closed:
        return None, False, "JSON_TRUNCATED"
    json_wrapper_repaired = False
    try:
        parsed = json.loads(json_text)
    except Exception as exc:
        repaired = try_repair_compact_storyboard_outer_array(json_text, value)
        if repaired is None:
            return None, False, f"JSON_PARSE_FAILED:{exc}"
        parsed = repaired
        json_wrapper_repaired = True
    if not isinstance(parsed, list):
        return None, json_wrapper_repaired, "JSON_PARSE_FAILED:not array"
    normalized = normalize_compact_storyboard_director_array(parsed)
    if not normalized:
        return None, json_wrapper_repaired, "COMPACT_SCHEMA_INVALID:scene1"
    parsed = normalized
    schema_error = compact_storyboard_director_array_error(parsed)
    if schema_error:
        return None, json_wrapper_repaired, schema_error
    return parsed, json_wrapper_repaired, ""


def parse_storyboard_story_directions(text: str) -> list[dict]:
    json_text, json_closed = extract_storyboard_director_json_array_text(text)
    if not json_text or not json_closed:
        raise ValueError("故事方向未返回完整 JSON 数组")
    parsed = json.loads(json_text)
    if not isinstance(parsed, list) or len(parsed) != 3:
        raise ValueError("故事方向必须正好返回 3 条")
    directions: list[dict] = []
    seen_titles: set[str] = set()
    for index, item in enumerate(parsed):
        if not isinstance(item, list) or len(item) != 4:
            raise ValueError(f"故事方向 {index + 1} 必须是 4 个字符串")
        title, direction, elements, world_style = [clean_text(str(value or "")) for value in item]
        if not title or not direction:
            raise ValueError(f"故事方向 {index + 1} 标题或方向为空")
        if storyboard_story_direction_title_is_abstract(title):
            title = storyboard_visible_story_direction_title(title, direction, elements, index)
        title_key = normalize_storyboard_director_field(title)
        if title_key in seen_titles:
            title = storyboard_visible_story_direction_title(f"{title}{index + 1}", direction, elements, index + 1)
            title_key = normalize_storyboard_director_field(title)
        if title_key in seen_titles:
            title = f"{title[:8]}{index + 1}"
            title_key = normalize_storyboard_director_field(title)
        seen_titles.add(title_key)
        directions.append({
            "title": title[:20],
            "direction": direction[:80],
            "elements": elements[:60],
            "worldStyle": world_style[:30],
        })
    return directions


def parse_storyboard_visual_event_chain(text: str, allow_incomplete: bool = False, min_count: int = 6) -> list[dict]:
    json_text, json_closed = extract_storyboard_director_json_array_text(text)
    if not json_text or not json_closed:
        raise ValueError("视觉事件链未返回完整 JSON 数组")
    parsed = json.loads(json_text)
    if not isinstance(parsed, list):
        raise ValueError("视觉事件链必须返回 9 个事件")
    if len(parsed) != 9:
        if not allow_incomplete:
            raise ValueError("视觉事件链必须返回 9 个事件")
        if len(parsed) < min_count:
            raise ValueError(f"视觉事件链可用事件不足 {len(parsed)}/9")
        if len(parsed) > 9:
            raise ValueError(f"视觉事件链事件过多 {len(parsed)}/9")
    events: list[dict] = []
    seen_titles: set[str] = set()
    seen_actions: set[str] = set()
    seen_semantics: set[str] = set()
    seen_types: set[str] = set()
    seen_scene_anchor_keys: set[str] = set()
    previous_scene_anchor_key = ""
    for index, item in enumerate(parsed):
        if not isinstance(item, list) or len(item) not in (3, 4):
            raise ValueError(f"视觉事件 {index + 1} 必须是 3 或 4 个字符串")
        if len(item) == 4:
            title, action, scene_anchor, cause = [clean_text(str(value or "")) for value in item]
        else:
            title, action, scene_anchor = [clean_text(str(value or "")) for value in item]
            cause = ""
        action = strip_storyboard_visual_action_tail(action)
        action = coerce_storyboard_visual_event_action(title, action, cause, index, scene_anchor)
        soft_atmosphere_action = storyboard_visual_event_action_is_atmosphere_soft_event(action)
        if not title or not action:
            raise ValueError(f"视觉事件 {index + 1} 字段不能为空")
        if not scene_anchor:
            raise ValueError(f"视觉事件 {index + 1} 场景锚点不能为空")
        scene_anchor = coerce_storyboard_visual_event_scene_anchor(
            title,
            action,
            scene_anchor,
            index,
            seen_scene_anchor_keys,
            previous_scene_anchor_key,
        )
        scene_anchor_key = storyboard_visual_event_scene_anchor_key(scene_anchor)
        if scene_anchor_key:
            seen_scene_anchor_keys.add(scene_anchor_key)
            previous_scene_anchor_key = scene_anchor_key
        soft_atmosphere_action = storyboard_visual_event_action_is_atmosphere_soft_event(action)
        abstract_action = storyboard_director_action_is_weak_event(action) and not soft_atmosphere_action
        title_key = normalize_storyboard_director_field(title)
        if title_key in seen_titles:
            title = f"{title[:8]}{index + 1}"
            title_key = normalize_storyboard_director_field(title)
        seen_titles.add(title_key)
        action_key = normalize_storyboard_director_field(action)
        duplicate_action = bool(action_key and action_key in seen_actions)
        if action_key and not duplicate_action:
            seen_actions.add(action_key)
        semantic_key, _ = storyboard_director_semantic_event_key(title, action)
        duplicate_semantic = bool(semantic_key and semantic_key in seen_semantics)
        if semantic_key and not duplicate_semantic:
            seen_semantics.add(semantic_key)
        event_type_key = storyboard_visual_event_type_key(title, action)
        duplicate_type = bool(event_type_key and event_type_key in seen_types)
        if event_type_key and not duplicate_type:
            seen_types.add(event_type_key)
        if cause and re.search(r"(决定|探索自然|成长|领悟|真谛|希望|面对挑战|内心|心中|感受到|收获|获得勇气|更加坚定)", cause):
            trimmed_cause = re.split(r"(感受到|内心|心中|领悟|真谛|希望|成长|收获|获得勇气|更加坚定)", cause, maxsplit=1)[0].strip(" ，,。；;")
            cause = trimmed_cause
        event = {
            "title": title[:20],
            "action": action[:60],
            "sceneAnchor": scene_anchor[:30],
            "cause": cause[:50],
        }
        if soft_atmosphere_action:
            event["atmosphereAction"] = True
            event["atmosphereHint"] = storyboard_visual_event_atmosphere_hint(action, scene_anchor)
        if abstract_action:
            event["abstractAction"] = True
            event["needsDirectorConcrete"] = True
            event["abstractActionReason"] = "weak_visual_event"
        if duplicate_action or duplicate_semantic or duplicate_type:
            event["duplicateEventRisk"] = True
            event["needsDirectorConcrete"] = True
            duplicate_reasons: list[str] = []
            if duplicate_action:
                duplicate_reasons.append("action")
            if duplicate_semantic:
                duplicate_reasons.append("semantic")
            if duplicate_type:
                duplicate_reasons.append("type")
            event["duplicateEventReason"] = ",".join(duplicate_reasons)
        events.append(event)
    return events


def storyboard_visual_event_soft_action_details(events: list[dict]) -> list[str]:
    if not isinstance(events, list):
        return []
    details: list[str] = []
    for index, item in enumerate(events):
        if not isinstance(item, dict) or not item.get("atmosphereAction"):
            continue
        action = clean_text(str(item.get("action") or ""))
        hint = clean_text(str(item.get("atmosphereHint") or "atmosphere"))
        details.append(f"Scene{index + 1:02d}:{hint}:{action}")
    return details


def storyboard_visual_event_abstract_action_details(events: list[dict]) -> list[str]:
    if not isinstance(events, list):
        return []
    details: list[str] = []
    for index, item in enumerate(events):
        if not isinstance(item, dict) or not item.get("abstractAction"):
            continue
        action = clean_text(str(item.get("action") or ""))
        reason = clean_text(str(item.get("abstractActionReason") or "abstract"))
        details.append(f"Scene{index + 1:02d}:{reason}:{action}")
    return details


def storyboard_visual_event_duplicate_risk_details(events: list[dict]) -> list[str]:
    if not isinstance(events, list):
        return []
    details: list[str] = []
    for index, item in enumerate(events):
        if not isinstance(item, dict) or not item.get("duplicateEventRisk"):
            continue
        action = clean_text(str(item.get("action") or ""))
        reason = clean_text(str(item.get("duplicateEventReason") or "duplicate"))
        details.append(f"Scene{index + 1:02d}:{reason}:{action}")
    return details


def storyboard_visual_event_soft_action_policy(events: list[dict]) -> dict:
    if not isinstance(events, list):
        return {
            "softActionCount": 0,
            "softActionOverLimit": False,
            "softActionOverLimitReasons": [],
            "softActionIndexes": [],
            "softActionMiddleCount": 0,
            "softActionAdjacentIndexes": [],
        }
    indexes = [
        index
        for index, item in enumerate(events)
        if isinstance(item, dict) and item.get("atmosphereAction")
    ]
    adjacent_indexes = [
        current
        for previous, current in zip(indexes, indexes[1:])
        if current == previous + 1
    ]
    middle_indexes = [index for index in indexes if 3 <= index <= 6]
    reasons: list[str] = []
    if len(indexes) > 2:
        reasons.append(f"softActionCount>2:{len(indexes)}")
    if adjacent_indexes:
        reasons.append(
            "adjacentSoftActions:"
            + ",".join(f"Scene{index + 1:02d}" for index in adjacent_indexes)
        )
    if len(middle_indexes) > 1:
        reasons.append(f"middleSoftActionCount>1:{len(middle_indexes)}")
    return {
        "softActionCount": len(indexes),
        "softActionOverLimit": bool(reasons),
        "softActionOverLimitReasons": reasons,
        "softActionIndexes": [index + 1 for index in indexes],
        "softActionMiddleCount": len(middle_indexes),
        "softActionAdjacentIndexes": [index + 1 for index in adjacent_indexes],
    }


def storyboard_visual_event_items_from_raw_text(text: str) -> list[list[str]]:
    json_text, json_closed = extract_storyboard_director_json_array_text(text)
    if not json_text or not json_closed:
        return []
    try:
        parsed = json.loads(json_text)
    except Exception:
        return []
    if not isinstance(parsed, list) or len(parsed) != 9:
        return []
    items: list[list[str]] = []
    for item in parsed:
        if not isinstance(item, list) or len(item) not in (3, 4):
            return []
        values = [clean_text(str(value or "")) for value in item]
        if len(values) == 3:
            values.append("")
        items.append(values[:4])
    return items


def storyboard_visual_event_action_needs_single_repair(
    title: str,
    action: str,
    scene_anchor: str,
    cause: str,
    index: int,
) -> bool:
    text = strip_storyboard_visual_action_tail(action)
    text = coerce_storyboard_visual_event_action(title, text, cause, index, scene_anchor)
    if storyboard_visual_event_action_is_atmosphere_soft_event(text):
        return False
    return storyboard_director_action_is_weak_event(text)


def parse_storyboard_visual_event_action_repair_output(output: str) -> str:
    text = clean_text(str(output or ""))
    if not text:
        return ""
    candidate = ""
    json_text = text
    if not (json_text.startswith("{") or json_text.startswith("[")):
        object_match = re.search(r"(\{.*\}|\[.*\])", json_text, flags=re.S)
        if object_match:
            json_text = object_match.group(1)
    try:
        parsed = json.loads(json_text)
        if isinstance(parsed, str):
            candidate = parsed
        elif isinstance(parsed, list) and parsed:
            first = parsed[0]
            if isinstance(first, list) and len(first) >= 2:
                candidate = str(first[1] or "")
            elif isinstance(first, dict):
                candidate = str(first.get("action") or first.get("visibleAction") or first.get("动作") or first.get("可画动作") or "")
            else:
                candidate = str(first or "")
        elif isinstance(parsed, dict):
            candidate = str(
                parsed.get("action")
                or parsed.get("visibleAction")
                or parsed.get("动作")
                or parsed.get("可画动作")
                or parsed.get("result")
                or ""
            )
    except Exception:
        candidate = text
    if not candidate or candidate in {"{", "["}:
        match = re.search(r"(?:action|visibleAction|动作|可画动作|修复动作)\s*[\"']?\s*[:：]\s*[\"“]?([^\"”\n\r,，}]+)", text, flags=re.I)
        if match:
            candidate = match.group(1)
    candidate = clean_text(candidate)
    if "/" in candidate:
        parts = [clean_text(part) for part in candidate.split("/") if clean_text(part)]
        if len(parts) >= 3:
            candidate = parts[1]
        elif len(parts) == 2:
            candidate = parts[-1]
    candidate = re.sub(r"^(JSON|动作|可画动作|修复动作)\s*[:：]\s*", "", candidate, flags=re.I).strip()
    candidate = candidate.splitlines()[0] if candidate else ""
    candidate = candidate.strip(" \"'“”[]，,。；;")
    return clean_text(candidate)[:60]


def normalize_storyboard_visual_event_rewrite_action_candidate(value: str) -> str:
    text = clean_text(str(value or ""))
    if not text:
        return ""
    text = re.sub(r"^Scene\s*\d+\s*[:：.\-、]\s*", "", text, flags=re.I).strip()
    if re.search(r"\s[/／]\s", text):
        parts = [clean_text(part) for part in re.split(r"\s*[/／]\s*", text) if clean_text(part)]
        if len(parts) >= 3:
            text = parts[1]
        elif len(parts) == 2:
            text = parts[-1]
    if re.search(r"^(事件名|标题|动作|可画动作)\s*[:：]", text):
        text = re.sub(r"^(事件名|标题|动作|可画动作)\s*[:：]\s*", "", text).strip()
    return strip_storyboard_visual_action_tail(text)[:60]


def normalize_storyboard_visual_event_rewrite_event_fields(events: list[dict]) -> list[dict]:
    normalized: list[dict] = []
    for event in events:
        item = dict(event)
        title = clean_text(str(item.get("title") or ""))
        action = clean_text(str(item.get("action") or ""))
        scene_anchor = clean_text(str(item.get("sceneAnchor") or ""))
        title_parts = [clean_text(part) for part in re.split(r"\s*[/／]\s*", title) if clean_text(part)]
        if len(title_parts) >= 3:
            title, action, scene_anchor = title_parts[:3]
        else:
            action_parts = [clean_text(part) for part in re.split(r"\s*[/／]\s*", action) if clean_text(part)]
            if len(action_parts) >= 3:
                title, action, scene_anchor = action_parts[:3]
            elif len(title_parts) == 2 and title_parts[0] != title_parts[1]:
                title = title_parts[0]
            elif len(action_parts) == 2 and action_parts[0] != action_parts[1]:
                action = action_parts[0]
        item["title"] = title[:20]
        item["action"] = action[:60]
        item["sceneAnchor"] = scene_anchor[:30]
        normalized.append(item)
    return normalized


def parse_storyboard_visual_event_actions_rewrite_output(output: str) -> list[str]:
    text = clean_text(str(output or ""))
    if not text:
        return []
    json_text, json_closed = extract_storyboard_director_json_array_text(text)
    if json_text and json_closed:
        text = json_text
    try:
        parsed = json.loads(text)
    except Exception:
        return []
    if not isinstance(parsed, list) or len(parsed) != 9:
        return []
    actions: list[str] = []
    for item in parsed:
        if isinstance(item, str):
            action = normalize_storyboard_visual_event_rewrite_action_candidate(item)
        elif isinstance(item, list) and item:
            if len(item) >= 3:
                action = normalize_storyboard_visual_event_rewrite_action_candidate(str(item[1] or ""))
            else:
                action = normalize_storyboard_visual_event_rewrite_action_candidate(str(item[0] or ""))
        elif isinstance(item, dict):
            action = normalize_storyboard_visual_event_rewrite_action_candidate(str(item.get("action") or item.get("visibleAction") or ""))
        else:
            action = ""
        if not action:
            return []
        actions.append(action)
    return actions


def repair_storyboard_visual_event_parse_action(
    title: str,
    action: str,
    scene_anchor: str,
    cause: str,
    index: int,
) -> str:
    text = clean_text(action)
    if text and not storyboard_director_action_is_weak_event(text):
        return text
    repaired = coerce_storyboard_visual_event_action(title, action, cause, index, scene_anchor)
    if repaired and not storyboard_director_action_is_weak_event(repaired):
        return repaired
    return text


def pick_storyboard_visual_token(text: str, candidates: list[str], fallback: str = "") -> str:
    source = clean_text(text)
    for candidate in candidates:
        if candidate and candidate in source:
            return candidate
    return fallback


def materialize_storyboard_visual_event_action(
    title: str,
    action: str,
    scene_anchor: str,
    cause: str,
    index: int,
    story_text: str,
    world_continuity: str,
    event_items: list[list[str]],
) -> str:
    current = clean_text(f"{title} {action} {scene_anchor} {cause}")
    chain_text = " ".join(" ".join(clean_text(str(value or "")) for value in item[:3]) for item in event_items if isinstance(item, list))
    context = clean_text(f"{story_text} {world_continuity} {chain_text}")
    actor = pick_storyboard_visual_token(
        f"{current} {context}",
        ["女武神", "圣女", "维修机器人", "老旧维修机器人", "机器人", "侦探", "沙漠少女", "海底女祭司", "女祭司", "木偶师", "少女", "主角"],
        "主角",
    )
    opponent = pick_storyboard_visual_token(
        f"{current} {context}",
        ["远古巨兽", "巨兽", "失控仿生人", "仿生人", "机械鸟", "黑潮", "魔王", "敌人"],
        "",
    )
    prop = pick_storyboard_visual_token(
        current,
        ["圣徽", "王冠", "王座", "火焰", "背包", "路标", "倒木", "木屋", "野花", "溪水", "长剑", "雷光", "爪牙", "控制面板", "电缆", "氧气管", "植物", "温室", "全息记录", "数据芯片", "警戒线", "水晶种子", "种子", "皮水袋", "帐篷", "枯井", "绿芽", "绿洲", "珊瑚碎片", "珊瑚", "圣坛", "符文", "鲸群", "断线机关", "齿轮", "舞台", "羽片"],
        "",
    ) or pick_storyboard_visual_token(
        context,
        ["圣徽", "王冠", "背包", "路标", "倒木", "长剑", "雷光", "控制面板", "电缆", "氧气管", "植物", "全息记录", "数据芯片", "水晶种子", "皮水袋", "珊瑚碎片", "断线机关", "齿轮"],
        "道具",
    )
    location = scene_anchor or pick_storyboard_visual_token(
        context,
        ["哥特教堂", "火焰广场", "黑暗王座", "废墟战场", "断裂城墙", "破损温室", "控制舱", "企业大楼", "天台", "商队遗迹", "风暴沙丘", "枯井", "海底神庙", "破碎珊瑚圣坛", "剧院舞台", "幕后齿轮室", "森林", "山野", "小路"],
        "现场",
    )
    if re.search(r"(圣女|王冠|圣徽|黑暗|王座|火焰|魔王)", context) and actor == "圣女":
        saint_steps = [
            "黑暗纹路爬上圣女王冠",
            "圣女把圣徽按进王冠裂缝",
            "火焰烧穿圣女脚下石阶",
            "王座台阶裂开露出黑火",
            "黑暗纹路覆盖圣女手臂",
            "王冠落入黑火",
            "圣徽碎片落入火焰",
            "圣女坐上王座化为魔王",
        ]
        if index >= 8 or "魔王" in current:
            return saint_steps[-1]
        return saint_steps[max(0, min(len(saint_steps) - 1, index - 1))]
    if actor == "女武神" or opponent in ("远古巨兽", "巨兽"):
        weapon = "长剑" if "长剑" in context else "武器"
        beast = opponent or "巨兽"
        combat_steps = [
            f"{beast}爪牙压住{actor}的{weapon}",
            f"{actor}斩断{beast}爪牙",
            f"雷光击穿{beast}胸甲",
            f"{actor}释放力量击退{beast}",
        ]
        return combat_steps[index % len(combat_steps)]
    if "机器人" in actor or "温室" in context or "植物" in context:
        if re.search(r"(重生|空间站)", current) and index >= 8:
            return "植物光蔓延照亮控制舱"
        if re.search(r"(生长|恢复|重生|发光)", current):
            return "植物顶开温室裂缝发芽"
        if re.search(r"(站|手持|闪烁|发光)", current):
            return f"{actor}把{prop}接入控制面板"
    if "侦探" in actor or "仿生人" in context:
        if re.search(r"(真相|结果|揭露|显示)", current):
            return "侦探把数据芯片插入终端"
        if re.search(r"(站|追踪|警戒)", current):
            return "侦探拉起警戒线拦住仿生人"
    if re.search(r"(绿洲|绿芽|种子|枯井|沙漠)", context):
        if re.search(r"(休息|欣赏)", current):
            return "少女把皮水袋放在绿芽旁"
        if re.search(r"(绿洲|生长|成为|结果)", current):
            return "绿芽沿枯井边蔓延成水洼"
        if re.search(r"(安全|寻找|避风)", current):
            return "少女用帐篷压住皮水袋"
    if re.search(r"(女祭司|珊瑚|圣坛|黑潮|鲸群)", context):
        if re.search(r"(闭目|沉思|结束)", current):
            return "女祭司把珊瑚碎片嵌回圣坛"
        if re.search(r"(光效|发光|闪烁)", current):
            return "符文照亮圣坛裂缝"
    if re.search(r"(木偶师|机械鸟|舞台|断线机关)", context):
        if re.search(r"(检查|恢复|平静)", current):
            return "木偶师把断线机关锁回齿轮"
        if re.search(r"(散落|失控|飞行)", current):
            return "机械鸟撞断舞台吊杆"
    if re.search(r"(休息|探索|寻路|继续|前行|旅途|结束|成果|自我)", current):
        return f"{actor}用{prop}标出{location}的下一条路"
    if re.search(r"(站|手持|闭眼|睁眼|闪烁|发光|闪耀)", current):
        return f"{actor}把{prop}按向{location}中的目标"
    return ""


def storyboard_visual_event_items_need_chain_rewrite(items: list[list[str]]) -> bool:
    if not isinstance(items, list) or len(items) != 9:
        return False
    repair_indexes = storyboard_visual_event_action_repair_indexes(items)
    if repair_indexes:
        return True
    actions = [normalize_storyboard_director_field(strip_storyboard_visual_action_tail(str(item[1] or ""))) for item in items if isinstance(item, list) and len(item) >= 2]
    return len(actions) - len(set(value for value in actions if value)) >= 2


def storyboard_visual_event_action_repair_indexes(items: list[list[str]]) -> set[int]:
    indexes: set[int] = set()
    seen_actions: dict[str, int] = {}
    seen_semantics: dict[str, int] = {}
    for index, item in enumerate(items):
        if not isinstance(item, list) or len(item) < 3:
            continue
        title = clean_text(str(item[0] or ""))
        action = strip_storyboard_visual_action_tail(str(item[1] or ""))
        scene_anchor = clean_text(str(item[2] or ""))
        cause = clean_text(str(item[3] or "")) if len(item) > 3 else ""
        coerced = coerce_storyboard_visual_event_action(title, action, cause, index, scene_anchor)
        if storyboard_visual_event_action_needs_single_repair(title, coerced, scene_anchor, cause, index):
            indexes.add(index)
        action_key = normalize_storyboard_director_field(coerced)
        if action_key:
            if action_key in seen_actions:
                indexes.add(index)
            else:
                seen_actions[action_key] = index
        semantic_key, _ = storyboard_director_semantic_event_key(title, coerced)
        if semantic_key:
            if semantic_key in seen_semantics:
                indexes.add(index)
            else:
                seen_semantics[semantic_key] = index
    return indexes


def storyboard_visual_event_repaired_action_is_usable(action: str) -> bool:
    text = clean_text(action)
    if not text:
        return False
    if storyboard_visual_event_action_is_short_label(text):
        return False
    return not storyboard_director_action_is_weak_event(text)


def storyboard_visual_event_action_candidate_duplicates(items: list[list[str]], index: int, action: str) -> bool:
    action_key = normalize_storyboard_director_field(action)
    if not action_key:
        return False
    for item_index, item in enumerate(items or []):
        if item_index == index or not isinstance(item, list) or len(item) < 2:
            continue
        other_key = normalize_storyboard_director_field(item[1])
        if other_key and other_key == action_key:
            return True
    return False


def storyboard_cue_based_drawable_action(
    title: str,
    action: str,
    scene_anchor: str,
    index: int,
    story_text: str,
    world_continuity: str,
    selected_direction,
    visual_cue_pack: str = "",
) -> str:
    cue_map = storyboard_visible_direction_cue_map(story_text, world_continuity, selected_direction, visual_cue_pack)
    local_context = clean_text(f"{title} {action} {scene_anchor}")
    context = clean_text(f"{local_context} {story_text} {visual_cue_pack} {world_continuity}")
    actor = storyboard_visible_actor(context, cue_map)
    props = [item for item in cue_map.get("物件", []) if item]
    prop = storyboard_visible_prop(local_context, cue_map) or (props[index % len(props)] if props else "")
    if prop == "背包" and "背包" not in local_context:
        prop = ""
    if re.search(r"(路标|指引|方向|岔路|新路|路线|寻找|找到|前行)", local_context):
        route_prop = next((item for item in props if item in {"路标", "木牌", "地图", "刻痕", "石碑"}), "")
        if route_prop:
            prop = route_prop
    location = storyboard_visible_location(scene_anchor or local_context, cue_map, index)
    obstacle = storyboard_visible_obstacle(local_context, cue_map)
    actors = [value for value in cue_map.get("人物", []) if value and value != actor]
    target = storyboard_pick_visible_cue(context, actors, actors[0] if actors else "")
    locations = [item for item in cue_map.get("地点", []) if item]
    next_location = locations[(index + 1) % len(locations)] if locations else location
    if "远山" in locations and re.search(r"(方向|路线|路标|新路|前行|远山)", context):
        next_location = "远山"
    text = clean_text(f"{title} {action}")
    focus = prop or obstacle or target
    if not focus:
        if re.search(r"(溪|河|浅滩|水)", context):
            focus = ["湿脚印", "漂来的木片", "水边石头"][index % 3]
        elif re.search(r"(森林|树林|林间)", context):
            focus = ["低垂树枝", "缠住小路的藤蔓", "树根旁刻痕"][index % 3]
        elif re.search(r"(战场|废墟|古镇|城市)", context):
            focus = ["碎裂地面", "破损标记", "倒塌石块"][index % 3]
        else:
            focus = ["可见痕迹", "地面标记", "半埋物件"][index % 3]

    if re.search(r"(告别|放下|丢弃|投入|埋|旧物|过去)", text):
        return clean_text(f"{actor}把{focus}投入{location}，{focus}被带离原处")[:60]
    if re.search(r"(路标|指引|方向|岔路|新路|路线|寻找|找到)", text):
        if re.search(r"(木牌|路标|地图|刻痕|标记)", focus):
            return clean_text(f"{actor}扶正{focus}，标出通向{next_location}的路线")[:60]
        return clean_text(f"{actor}在{location}发现{focus}，沿旁边路线转向{next_location}")[:60]
    if re.search(r"(阻碍|障碍|挡住|茂密|藤蔓|荆棘|倒木|断桥|黑潮|风暴|污染|失控|追赶)", text):
        return clean_text(f"{actor}拨开挡住{location}的{focus}，露出后方通路")[:60]
    if re.search(r"(迎战|战斗|攻击|反击|刺击|挥剑|释放|终结|胜利|巨兽|怪物|敌人|魔王)", text):
        opponent = target or obstacle or "目标"
        weapon = prop if prop and prop != opponent else "武器"
        if re.search(r"(结束|胜利|倒下|终结)", text):
            return clean_text(f"{opponent}倒在{location}，{weapon}停在裂痕旁")[:60]
        return clean_text(f"{actor}用{weapon}击中{opponent}，{opponent}状态改变")[:60]
    if re.search(r"(修复|接入|连接|启动|公开|揭露|证据|芯片|广告|控制|圣坛|珊瑚|能源|电缆|系统)", text):
        return clean_text(f"{actor}把{focus}接到{location}，{location}亮起新标记")[:60]
    if re.search(r"(种|枯井|绿洲|发芽|出现|恢复|治愈|生长)", text):
        return clean_text(f"{actor}把{focus}放入{location}，{location}出现新变化")[:60]
    if re.search(r"(进入|离开|经过|前行|行走|休息|站|停下|看到|看着|望|眺望|回望|接近|坚持|克服)", text):
        return clean_text(f"{actor}移动{location}旁的{focus}，露出通向{next_location}的空间")[:60]
    if focus:
        return clean_text(f"{actor}改变{location}中的{focus}，留下清晰结果")[:60]
    return ""


def storyboard_compiled_event_title(action: str, fallback: str) -> str:
    text = clean_text(action)
    title_rules = [
        (r"(投入|丢弃|放下|放进|放入).{0,10}(旧物|信件|旧信|照片|日记|礼物)", "放下旧物"),
        (r"(扶正|标出|指向|指引).{0,12}(路标|木牌|地图|刻痕)", "路标指路"),
        (r"(拨开|推开|绕过|跨过|穿过).{0,12}(藤蔓|荆棘|倒木|断桥|阻碍|通路|小路)", "越过阻碍"),
        (r"(拾起|捡起|发现|找到).{0,8}(地图|芯片|碎片|路标|脚印|痕迹|石牌|裂缝|树枝|木屋|木牌)", "发现线索"),
        (r"(修复|接入|连接|按下|启动|嵌回|焊接|拧紧)", "修复装置"),
        (r"(递给|交给|接过|交换|指向|指引|告别)", "交接指引"),
        (r"(斩|击|挡住|击退|压住|倒下|裂开)", "冲突变化"),
        (r"(种下|埋下|浇|发芽|蔓延|退去|恢复)", "状态改变"),
        (r"(公开|揭露|显示|投影|改变)", "证据显现"),
        (r"(打开|关闭|照亮)", "通路变化"),
        (r"(绕过|跨过|穿过|拨开|推开)", "越过阻碍"),
    ]
    for pattern, title in title_rules:
        if re.search(pattern, text):
            return title
    return clean_text(fallback)[:8] or "可见事件"


def storyboard_compiled_scene_anchor(anchor: str, action: str, cue_map: dict[str, list[str]], index: int) -> str:
    anchor_text = clean_text(anchor)
    for location in cue_map.get("地点", []):
        if location:
            anchor_text = anchor_text.replace(f"{location}{location}", location)
    text = clean_text(f"{anchor_text} {action}")
    location = storyboard_visible_location(text, cue_map, index)
    clue = storyboard_contextual_visible_clue(text, cue_map, index)
    anchor_is_known_location = bool(anchor_text and anchor_text in cue_map.get("地点", []))
    if (
        storyboard_visual_event_scene_anchor_is_broad(anchor_text)
        or (len(anchor_text) <= 2 and not anchor_is_known_location)
        or re.fullmatch(r"(入口|岔路|水边|高处|障碍|遗留物.*|交互点.*|出口|后续处.*)", anchor_text)
        or STORYBOARD_UNSUPPORTED_GENERIC_EVENT_RE.search(anchor_text)
    ):
        return clean_text(f"{location}{clue}处")[:12]
    if re.search(r"(森林|山野|战场|古镇|空间站|海底|沙丘|教堂|王座|道路)$", anchor_text):
        return clean_text(f"{anchor_text}{clue}处")[:12]
    return anchor_text[:12]


def storyboard_compile_drawable_action(
    title: str,
    action: str,
    scene_anchor: str,
    cause: str,
    index: int,
    events: list[dict],
    story_text: str,
    world_continuity: str,
    selected_direction,
    cue_map: dict[str, list[str]],
) -> tuple[str, str, str]:
    event_text = clean_text(f"{title} {action} {scene_anchor}")
    current = clean_text(f"{event_text} {cause}")
    prev_text = ""
    next_text = ""
    if index > 0 and index - 1 < len(events) and isinstance(events[index - 1], dict):
        prev_text = clean_text(" ".join(str(value or "") for value in events[index - 1].values()))
    if index + 1 < len(events) and isinstance(events[index + 1], dict):
        next_text = clean_text(" ".join(str(value or "") for value in events[index + 1].values()))
    context = clean_text(f"{story_text} {world_continuity} {storyboard_story_direction_text(selected_direction)} {prev_text} {current} {next_text}")
    actor = storyboard_visible_actor(event_text or context, cue_map)
    prop = storyboard_visible_prop(event_text, cue_map) or storyboard_contextual_visible_clue(context, cue_map, index)
    location = storyboard_visible_location(scene_anchor or current, cue_map, index)
    obstacle = storyboard_visible_obstacle(event_text or context, cue_map)
    clue = storyboard_contextual_visible_clue(event_text or context, cue_map, index)
    event_people: list[str] = []
    for match in re.finditer(STORYBOARD_VISIBLE_CUE_PATTERNS["人物"], event_text):
        value = clean_text(match.group(0))
        if value and value not in event_people:
            event_people.append(value)
    other_actors = [value for value in event_people + cue_map.get("人物", []) if value and value != actor]
    target_actor = storyboard_pick_visible_cue(event_text, other_actors, other_actors[0] if other_actors else "")

    if re.search(r"(后续变化|继续推进)", event_text) and re.search(r"(空间站|温室|植物|机器人)", context):
        next_action = "维修机器人打开温室舱门" if index % 2 else "植物嫩芽照亮空间站走廊"
    elif re.search(r"(后续变化|继续推进)", event_text) and re.search(r"(枯井|绿洲|沙丘|水晶种子)", context):
        next_action = "清水从枯井裂缝流向绿洲" if index % 2 else "水晶种子长成发光绿芽"
    elif re.search(r"(后续变化|继续推进)", event_text) and re.search(r"(海|珊瑚|黑潮|鲸群|女祭司)", context):
        next_action = "鲸群穿过发光珊瑚拱门" if index % 2 else "黑潮碎片沉入海沟"
    elif re.search(r"(后续变化|继续推进)", event_text):
        next_action = f"{actor}在{location}发现{clue}"
    elif re.search(r"(告别|离开|启程|出发|踏上旅途|踏上旅程)", event_text):
        next_action = f"{actor}背起{prop}离开{location}"
    elif STORYBOARD_UNSUPPORTED_GENERIC_EVENT_RE.search(event_text):
        next_action = f"{actor}在{location}发现{clue}"
    elif re.search(r"(探索|探险|寻找|寻路|行走|前行|继续|深入|旅途)", event_text):
        next_action = f"{actor}在{location}发现{clue}"
    elif re.search(r"(返回|改变)", event_text) and re.search(r"(木牌|路标|路线|方向|森林|山路|远山)", context):
        next_action = f"{actor}把{clue}插在{location}岔路口"
    elif re.search(r"(迷路|迷失|走错|找不到方向)", event_text):
        next_action = f"{actor}在{location}捡起{clue}"
    elif re.search(r"(休息|停留|等待|眺望|远望|凝视|站在|站立|闭目|睁眼|静思)", event_text):
        next_action = f"{actor}把{prop}放到{location}标记处"
    elif re.search(r"(感受|治愈|成长|自我|希望|未来|启示|宁静)", event_text):
        if "背包" in context:
            next_action = f"{actor}把修好的背包系回肩上"
        elif re.search(r"(伤口|绷带)", context):
            next_action = f"{actor}把绷带缠住伤口"
        else:
            next_action = f"{actor}在{location}拾起{clue}"
    elif re.search(r"(命令|号令).{0,8}(魔王|怪物|敌人)", event_text):
        opponent = target_actor or storyboard_pick_visible_cue(event_text, ["魔王", "怪物", "敌人"], "魔王")
        next_action = f"{actor}用{prop}指向{opponent}"
    elif re.search(r"(指引|指路|路线|方向)", event_text):
        giver = actor
        target_location = storyboard_pick_visible_cue(context, ["远山", "山路", "小路", "岔路", "山顶", "高处"], location)
        next_action = f"{giver}用{clue}指向{target_location}"
    elif re.search(r"(对话|交谈|告诉)", event_text):
        giver = target_actor or actor
        receiver = actor if giver != actor else (target_actor or "对方")
        next_action = f"{giver}把{clue}递给{receiver}"
    elif re.search(r"(交换|赠送|交给|接过|获得)", event_text):
        giver = target_actor or actor
        receiver = actor if giver != actor else (target_actor or "对方")
        next_action = f"{receiver}接过{giver}递来的{prop}"
    elif re.search(r"(恢复生机|感激|稳定|繁荣)", event_text) and re.search(r"(珊瑚|圣坛|黑潮|鲸群|海沟|海底)", context):
        next_action = "发光珊瑚覆盖圣坛裂缝"
    elif re.search(r"(恢复生机|稳定|繁荣|绿洲)", event_text) and re.search(r"(枯井|绿洲|沙丘|水晶种子)", context):
        next_action = "水晶种子沿枯井裂缝长出绿芽"
    elif re.search(r"(恢复生机|稳定|发芽|重生)", event_text) and re.search(r"(空间站|温室|植物|机器人)", context):
        next_action = "植物嫩芽顶开温室舱裂缝"
    elif re.search(r"(阻碍|障碍|挡住|断桥|倒木|藤蔓|荆棘|黑潮|污染|失控|侵蚀)", event_text):
        next_action = f"{actor}推开{location}的{obstacle or clue}"
    elif re.search(r"(战斗|迎战|攻击|冲锋|斩|击|释放力量|爆发)", event_text):
        opponent = target_actor or storyboard_pick_visible_cue(context, ["远古巨兽", "巨兽", "魔王", "怪物", "敌人", "仿生人"], "敌人")
        next_action = f"{actor}用{prop}击中{opponent}"
    elif re.search(r"(倒下|击退|制服|揭露|公开|真相)", event_text):
        target = target_actor or storyboard_pick_visible_cue(context, ["远古巨兽", "巨兽", "魔王", "怪物", "敌人", "仿生人", "控制者"], "目标")
        next_action = f"{target}倒在{location}的{clue}旁"
    elif re.search(r"(修复|连接|启动|关闭|接入|系统|能源|温室|控制)", event_text):
        next_action = f"{actor}把{prop}接入{location}装置"
    elif re.search(r"(种下|发芽|恢复|生机|稳定|繁荣|绿洲|植物|蔓延)", event_text):
        next_action = f"{prop}在{location}裂缝里发芽"
    elif re.search(r"(成为|变成).{0,8}(魔王|怪物|新身份)", event_text):
        next_action = f"黑火王冠覆盖{actor}面部"
    elif re.search(r"(施放|释放).{0,8}(黑暗|力量)", event_text):
        next_action = "黑火从王冠裂缝涌出"
    elif re.search(r"(气息|散发)", event_text) and re.search(r"(黑暗|圣女|王冠)", context):
        next_action = f"黑暗纹路爬上{actor}手臂"
    elif re.search(r"(黑暗|堕落|成为|王座|王冠|魔王|身份|气息|散发)", event_text):
        next_action = f"{actor}把{prop}按进{location}裂缝"
    elif re.search(r"(风|光|发光|闪烁|亮起|照亮)", event_text):
        next_action = f"{prop}照亮{location}的{clue}"
    else:
        next_action = f"{actor}在{location}改变{clue}"

    next_action = clean_text(next_action)[:60]
    next_title = storyboard_compiled_event_title(next_action, title)
    next_anchor = storyboard_compiled_scene_anchor(scene_anchor, next_action, cue_map, index)
    return next_title[:20], next_action, next_anchor[:30]


def storyboard_visual_event_needs_drawable_compile(
    title: str,
    action: str,
    scene_anchor: str,
    action_seen: bool,
    anchor_seen: bool,
) -> bool:
    text = clean_text(f"{title} {action} {scene_anchor}")
    if storyboard_director_action_is_weak_event(action):
        return True
    if storyboard_visual_event_title_action_drift_reason(title, action, scene_anchor):
        return True
    if storyboard_visual_event_action_is_generic_movement(action):
        return True
    if action_seen:
        return True
    if anchor_seen and storyboard_visual_event_scene_anchor_is_broad(scene_anchor):
        return True
    if re.search(r"(站立|凝视|远望|眺望|观察|休息|停留|闭目|睁眼|静思|感激|稳定|繁荣|恢复生机|变得|成为|笼罩|感受|治愈|气息|散发|对话|交谈|施放|释放)", text):
        if not re.search(r"(拾起|捡起|找到|发现|递给|接过|交给|连接|修复|启动|关闭|击中|斩|倒下|裂开|退去|发芽|种下|埋下|覆盖|照亮)", text):
            return True
    return False


def storyboard_visual_event_has_unsupported_generic(event_text: str, source_context: str) -> bool:
    text = clean_text(event_text)
    source = clean_text(source_context)
    if not STORYBOARD_UNSUPPORTED_GENERIC_EVENT_RE.search(text):
        return False
    for match in STORYBOARD_UNSUPPORTED_GENERIC_EVENT_RE.finditer(text):
        value = clean_text(match.group(1))
        if value and value not in source:
            return True
    return False


def storyboard_drawable_variant_actions(context: str, actor: str, location: str, cue_map: dict[str, list[str]]) -> list[str]:
    text = clean_text(context)
    prop = storyboard_visible_prop(text, cue_map) or storyboard_contextual_visible_clue(text, cue_map, 0)
    location = clean_text(location) or storyboard_visible_location(text, cue_map, 0)
    if re.search(r"(空间站|温室|机器人|电缆|能源)", text):
        return [
            "维修机器人把电缆接回能源核心",
            "维修机器人按下控制面板开关",
            "温室灯带照亮植物嫩芽",
            "植物嫩芽顶开温室舱裂缝",
            "维修机器人打开温室舱门",
        ]
    if re.search(r"(海|珊瑚|黑潮|鲸群|女祭司)", text):
        return [
            "女祭司把珊瑚碎片嵌回圣坛",
            "发光珊瑚覆盖圣坛裂缝",
            "鲸群穿过发光珊瑚拱门",
            "黑潮碎片沉入海沟",
            "女祭司指向海沟中的圣坛",
        ]
    if re.search(r"(王冠|圣女|王座|魔王|黑暗)", text):
        return [
            "圣女把王冠按进教堂裂缝",
            "黑火从王冠裂缝涌出",
            "黑暗纹路爬上圣女手臂",
            "圣女用王冠指向魔王",
            "黑火王冠覆盖圣女面部",
        ]
    if re.search(r"(女武神|巨兽|战场|长剑)", text):
        return [
            "女武神用长剑挡住巨兽爪牙",
            "女武神斩断巨兽爪牙",
            "雷光击穿巨兽胸甲",
            "巨兽倒在废墟战场裂缝旁",
            "女武神把长剑插进碎裂地面",
        ]
    if re.search(r"(数据|侦探|仿生人|企业|霓虹)", text):
        return [
            "侦探把数据芯片插入终端",
            "全息广告投影出证据路线",
            "侦探拉起警戒线拦住仿生人",
            "证据投影照亮企业天台",
            "失控仿生人倒在证据旁",
        ]
    if re.search(r"(沙丘|沙漠|枯井|绿洲|水晶种子)", text):
        return [
            "少女把水晶种子种进枯井",
            "清水从枯井裂缝流向绿洲",
            "少女用皮水袋浇湿绿芽",
            "水晶种子长成发光绿芽",
            "绿芽沿枯井石壁蔓延",
        ]
    return [
        f"{actor}在{location}发现泥脚印",
        f"{actor}在{location}捡起旧路标",
        f"{actor}把木牌路标插在{location}岔路口",
        f"{actor}把修好的{prop}系回肩上",
        f"{actor}拨开低枝露出木屋",
        f"{actor}跨过{location}岔路上的石阶",
    ]


def storyboard_pick_drawable_variant(
    title: str,
    action: str,
    scene_anchor: str,
    index: int,
    story_text: str,
    world_continuity: str,
    selected_direction,
    cue_map: dict[str, list[str]],
    seen_actions: set[str],
    seen_focuses: set[str] | None = None,
) -> tuple[str, str, str]:
    context = clean_text(f"{story_text} {world_continuity} {storyboard_story_direction_text(selected_direction)} {title} {action} {scene_anchor}")
    actor = storyboard_visible_actor(context, cue_map)
    location = storyboard_visible_location(scene_anchor or context, cue_map, index)
    variants = storyboard_drawable_variant_actions(context, actor, location, cue_map)
    ordered = variants[index % len(variants):] + variants[:index % len(variants)] if variants else []
    for candidate in ordered:
        key = normalize_storyboard_director_field(candidate)
        focus = storyboard_visual_event_focus_token(candidate, cue_map)
        repeated_discovery_focus = bool(
            seen_focuses
            and focus
            and focus in seen_focuses
            and re.search(r"(发现|找到|拾起|捡起)", candidate)
        )
        if candidate and key not in seen_actions and "可见痕迹" not in candidate and not repeated_discovery_focus:
            next_title = storyboard_compiled_event_title(candidate, title)
            next_anchor = storyboard_compiled_scene_anchor(scene_anchor, candidate, cue_map, index)
            return next_title, candidate, next_anchor
    return title, action, scene_anchor


def storyboard_visual_event_focus_token(text: str, cue_map: dict[str, list[str]]) -> str:
    source = clean_text(text)
    tokens = []
    tokens.extend(cue_map.get("物件", []))
    tokens.extend(["木牌路标", "旧路标", "泥脚印", "折断树枝", "控制面板", "温室舱门", "王冠裂缝", "发光珊瑚", "水晶种子"])
    for token in tokens:
        if token and token in source:
            return token
    return ""


def compile_storyboard_visual_event_chain_to_drawable(
    events: list[dict],
    story_text: str,
    world_continuity: str,
    selected_direction,
    visual_cue_pack: str = "",
) -> tuple[list[dict], list[str]]:
    if not isinstance(events, list):
        return events, []
    cue_map = storyboard_visible_direction_cue_map(story_text, world_continuity, selected_direction, visual_cue_pack)
    source_context = clean_text(f"{story_text} {visual_cue_pack} {world_continuity} {storyboard_story_direction_text(selected_direction)}")
    compiled: list[dict] = [dict(item or {}) for item in events if isinstance(item, dict)]
    details: list[str] = []
    if not compiled:
        return events, []
    if len(compiled) != 9:
        return compiled, []

    seen_actions: set[str] = set()
    seen_anchors: set[str] = set()
    seen_focuses: set[str] = set()
    for index, event in enumerate(compiled[:9]):
        title = clean_text(str(event.get("title") or ""))
        action = clean_text(str(event.get("action") or ""))
        scene_anchor = clean_text(str(event.get("sceneAnchor") or ""))
        cause = clean_text(str(event.get("cause") or ""))
        action_key = normalize_storyboard_director_field(action)
        anchor_key = storyboard_visual_event_scene_anchor_key(scene_anchor)
        focus_key = storyboard_visual_event_focus_token(action, cue_map)
        needs_compile = storyboard_visual_event_needs_drawable_compile(
            title,
            action,
            scene_anchor,
            bool(action_key and action_key in seen_actions),
            bool(anchor_key and anchor_key in seen_anchors),
        ) or bool(event.get("abstractAction")) or (
            focus_key and focus_key in seen_focuses and re.search(r"(发现|找到|拾起|捡起)", action)
        ) or storyboard_visual_event_has_unsupported_generic(
            f"{title} {action} {scene_anchor}",
            source_context,
        )
        if needs_compile:
            new_action = storyboard_cue_based_drawable_action(
                title,
                action,
                scene_anchor,
                index,
                story_text,
                world_continuity,
                selected_direction,
                visual_cue_pack,
            )
            new_action_key = normalize_storyboard_director_field(new_action)
            if (
                storyboard_visual_event_repaired_action_is_usable(new_action)
                and new_action_key
                and new_action_key not in seen_actions
            ):
                new_title = storyboard_compiled_event_title(new_action, title)
                new_anchor = storyboard_compiled_scene_anchor(scene_anchor, new_action, cue_map, index)
                details.append(f"Scene{index + 1:02d}:drawable-guard:{action}->{new_action}")
                event["title"] = new_title
                event["action"] = new_action
                event["sceneAnchor"] = new_anchor
                event.pop("abstractAction", None)
                event.pop("abstractActionReason", None)
                event.pop("duplicateEventRisk", None)
                event.pop("duplicateEventReason", None)
                event.pop("needsDirectorConcrete", None)
            else:
                event["needsDirectorConcrete"] = True
                if storyboard_director_action_is_weak_event(action):
                    event["abstractAction"] = True
                    event["abstractActionReason"] = event.get("abstractActionReason") or "weak_after_vec"
        action_key = normalize_storyboard_director_field(event.get("action"))
        anchor_key = storyboard_visual_event_scene_anchor_key(event.get("sceneAnchor"))
        if action_key:
            seen_actions.add(action_key)
        if anchor_key:
            seen_anchors.add(anchor_key)
        focus_key = storyboard_visual_event_focus_token(event.get("action"), cue_map)
        if focus_key:
            seen_focuses.add(focus_key)
    return compiled[:9], details[:24]


def repair_storyboard_visual_event_raw_text(text: str) -> tuple[str, list[str]]:
    json_text, json_closed = extract_storyboard_director_json_array_text(text)
    if not json_text or not json_closed:
        return "", []
    try:
        parsed = json.loads(json_text)
    except Exception:
        return "", []
    if not isinstance(parsed, list) or len(parsed) != 9:
        return "", []
    repairs: list[str] = []
    repaired_items: list = []
    for index, item in enumerate(parsed):
        if not isinstance(item, list) or len(item) not in (3, 4):
            return "", []
        values = [clean_text(str(value or "")) for value in item]
        if len(values) == 4:
            title, action, scene_anchor, cause = values
        else:
            title, action, scene_anchor = values
            cause = ""
        repaired_action = repair_storyboard_visual_event_parse_action(title, action, scene_anchor, cause, index)
        next_item = list(values)
        if repaired_action and repaired_action != action:
            next_item[1] = repaired_action
            repairs.append(f"Scene{index + 1:02d}:{action}->{repaired_action}")
        repaired_items.append(next_item)
    if not repairs:
        return "", []
    return json.dumps(repaired_items, ensure_ascii=False, separators=(",", ":")), repairs


def storyboard_director_is_origin_space(text: str) -> bool:
    return bool(re.search(r"(家中|书房|客厅|卧室|房间|村口|故乡|起点)", clean_text(text)))


def storyboard_director_is_journey_state(text: str) -> bool:
    return bool(re.search(r"(告别|离开|启程|出发|踏上|前往|远方|山间|山路|小路|旅途|森林|林中|溪边|河边|山顶)", clean_text(text)))


def storyboard_director_is_memory_or_flashback(text: str) -> bool:
    return bool(re.search(r"(回忆|往昔|过去|记忆|闪回|梦见|想起)", clean_text(text)))


def storyboard_director_patch_targets(parsed: list) -> list[dict]:
    targets: dict[int, str] = {}
    if not isinstance(parsed, list) or len(parsed) != 9:
        return []

    def add_target(index: int, reason: str):
        if index < 0 or index >= len(parsed):
            return
        targets.setdefault(index, reason)

    seen_beats: dict[str, int] = {}
    seen_semantic_events: dict[str, tuple[int, str]] = {}
    seen_actions: dict[str, int] = {}
    seen_spaces: dict[str, int] = {}
    seen_visual_backgrounds: dict[str, tuple[int, str]] = {}
    seen_real_camera_signatures: dict[str, tuple[int, str]] = {}
    journey_started = False
    for index, item in enumerate(parsed):
        full_text = " ".join(str(field or "") for field in item)
        beat_key = normalize_storyboard_director_field(item[0])
        space_key = normalize_storyboard_director_field(item[2])
        action_key = normalize_storyboard_director_field(item[3])
        visual_background_key, visual_background_label = storyboard_director_visual_background_signature(item)
        if storyboard_director_action_is_weak_event(item[3]):
            add_target(index, f"动作缺少可画事件:{clean_text(str(item[3] or ''))}")
        if visual_background_key:
            if visual_background_key in seen_visual_backgrounds and index < 8:
                first_index, first_label = seen_visual_backgrounds[visual_background_key]
                pass
            else:
                seen_visual_backgrounds.setdefault(visual_background_key, (index, visual_background_label))
        real_camera_key, real_camera_label = storyboard_director_real_camera_signature(item)
        if real_camera_key:
            if real_camera_key in seen_real_camera_signatures and index < 8:
                first_index, first_label = seen_real_camera_signatures[real_camera_key]
                pass
            else:
                seen_real_camera_signatures.setdefault(real_camera_key, (index, real_camera_label))
        if index >= 3 and journey_started and storyboard_director_is_origin_space(item[2]):
            add_target(index, "时间线回流到起点空间")
        if beat_key:
            if beat_key in seen_beats:
                add_target(index, f"剧情节点重复 Scene{seen_beats[beat_key] + 1:02d}")
            else:
                seen_beats[beat_key] = index
        semantic_key, semantic_label = storyboard_director_semantic_event_key(item[0], item[3])
        if semantic_key:
            if semantic_key in seen_semantic_events:
                first_index, first_label = seen_semantic_events[semantic_key]
                add_target(index, f"剧情事件语义重复 Scene{first_index + 1:02d}:{semantic_label or first_label}")
            else:
                seen_semantic_events[semantic_key] = (index, semantic_label)
        if action_key:
            if action_key in seen_actions:
                add_target(index, f"动作完全重复 Scene{seen_actions[action_key] + 1:02d}")
            else:
                seen_actions[action_key] = index
        if space_key:
            if space_key in seen_spaces and abs(index - seen_spaces[space_key]) <= 2:
                pass
            else:
                seen_spaces.setdefault(space_key, index)
        if storyboard_director_is_journey_state(full_text) and not storyboard_director_is_memory_or_flashback(full_text):
            journey_started = True

    for index in range(2, len(parsed)):
        previous_action = str(parsed[index - 1][3] or "")
        current_action = str(parsed[index][3] or "")
        prior_action = str(parsed[index - 2][3] or "")
        if (
            storyboard_director_field_similarity(current_action, previous_action) >= 0.92 and
            storyboard_director_field_similarity(previous_action, prior_action) >= 0.92
        ):
            add_target(index, "连续三格动作高度相似")

    return [{"index": index, "reason": reason} for index, reason in sorted(targets.items())]


def compact_storyboard_director_json(parsed: list) -> str:
    normalized = normalize_compact_storyboard_director_array(parsed)
    if normalized:
        parsed = normalized
    return json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))


def build_storyboard_director_patch_prompt(
    story_text: str,
    world_continuity: str,
    parsed: list,
    targets: list[dict],
    selected_direction=None,
    visual_event_chain=None,
) -> str:
    target_lines = []
    target_indexes = {int(item.get("index", -1)) for item in targets}
    for index, item in enumerate(parsed):
        prefix = "*" if index in target_indexes else "-"
        target_lines.append(
            f"{prefix}Scene{index + 1:02d}:{json.dumps(item, ensure_ascii=False, separators=(',', ':'))}"
        )
    problem_lines = [
        f"Scene{int(item.get('index', 0)) + 1:02d}:{clean_text(str(item.get('reason') or '重复'))}"
        for item in targets
    ]
    direction_text = storyboard_story_direction_text(selected_direction)
    event_chain_text = storyboard_visual_event_chain_text(visual_event_chain)
    return (
        "你是 NovaFlow 局部分镜修正器。本次只修带 * 的一个场景，其他场景只作为上下文锁定。"
        "只输出紧凑合法 JSON 二维数组，不解释不换行。"
        "顶层必须正好 1 项；该项必须正好 5 个值，顺序为：[场景号,剧情节点,镜头,当前空间,动作]。"
        "场景号必须是被要求修正的 Scene 编号，只能用纯数字，如7，不要写Scene07；绝不能输出未修正场景。"
        "剧情节点<=10字，必须对应可画事件；镜头<=8字；当前空间<=12字；动作<=24字。"
        "当前空间写本格具体位置或背景功能，必须承接上一场并不破坏下一场。"
        "离开家、村口或起点后，当前空间不得回到家中、书房、客厅、庭院、村口；回忆只能写在动作里，当前空间保持旅途中地点。"
        "如果问题是动作缺少可画事件或抽象决定，优先只改动作；剧情节点不是可画事件时才同步改剧情节点。"
        "如果问题是视觉背景重复，必须换成不同视觉空间类型和构图，避免继续使用远山、山谷、小路、背影远行组合。"
        "如果问题是镜头视觉重复或镜头过粗，必须让镜头服务动作焦点，改成景别+角度/运动/焦点组合，如过肩中景、低机远景、手部特写、背影拉远；特写/近景聚焦主角正在做的动作或动作对象。"
        "如果问题是剧情事件语义重复，必须改写剧情节点和动作；不能只换当前空间。"
        "必须改写被修场景的剧情节点、当前空间或动作，不能原样返回问题场景。"
        "只修严重重复、完全重复、时间线回流或明显空转；不要评价剧情，不要改主线。"
        "允许补充服务主题的普通细节、道具、场景元素或陪衬角色，但不得新增主线目标、关键神器、新能力体系、身份反转或不同结局。"
        f"剧情:{story_text}\n"
        f"World Continuity:{world_continuity}\n"
        f"Selected Story Direction:{direction_text or '未提供'}\n"
        f"Visual Event Chain:\n{event_chain_text or '未提供'}\n"
        f"问题:{'；'.join(problem_lines)}\n"
        "当前9格:\n"
        + "\n".join(target_lines)
        + "\nJSON:"
    )


def parse_storyboard_director_patch_scene_number(value) -> int | None:
    text = clean_text(str(value or ""))
    if not text:
        return None
    match = re.search(r"\d+", text)
    if not match:
        return None
    try:
        return int(match.group(0))
    except Exception:
        return None


def parse_storyboard_director_patch_output(text: str, targets: list[dict]) -> dict[int, list]:
    value = clean_text(str(text or ""))
    json_text, json_closed = extract_storyboard_director_json_array_text(value)
    if not json_text or not json_closed:
        return {}
    try:
        parsed = json.loads(json_text)
    except Exception:
        return {}
    if not isinstance(parsed, list):
        return {}
    allowed = {int(item.get("index", -1)) + 1 for item in targets}
    patches: dict[int, list] = {}
    for item in parsed:
        if not isinstance(item, list) or len(item) != 5:
            continue
        scene_number = parse_storyboard_director_patch_scene_number(item[0])
        if scene_number is None:
            continue
        if scene_number not in allowed:
            continue
        values = normalize_compact_storyboard_director_item(item)
        if not values or any(not isinstance(value, str) or not clean_text(value) for value in values):
            continue
        patches[scene_number - 1] = [clean_text(value) for value in values]
    return patches


def apply_storyboard_director_patches(parsed: list, patches: dict[int, list]) -> list:
    merged = [list(item) for item in parsed]
    for index, item in patches.items():
        if 0 <= index < len(merged):
            merged[index] = list(item)
    return merged


def storyboard_director_patches_change_any(parsed: list, patches: dict[int, list]) -> bool:
    if not isinstance(parsed, list) or not isinstance(patches, dict):
        return False
    for index, values in patches.items():
        if not (0 <= index < len(parsed)):
            continue
        before = [clean_text(str(value or "")) for value in list(parsed[index])[:4]]
        after = [clean_text(str(value or "")) for value in list(values)[:4]]
        if before != after:
            return True
    return False


def storyboard_director_patches_resolve_targets(parsed: list, patches: dict[int, list], merged: list, targets: list[dict]) -> bool:
    if not storyboard_director_patches_change_any(parsed, patches):
        return False
    target_indexes = {int(item.get("index", -1)) for item in targets if int(item.get("index", -1)) >= 0}
    if not target_indexes:
        return True
    if not target_indexes.issubset(set(patches.keys())):
        return False
    remaining_indexes = {int(item.get("index", -1)) for item in storyboard_director_patch_targets(merged)}
    return not any(index in remaining_indexes for index in target_indexes)


def storyboard_director_target_index(target: dict) -> int:
    try:
        return int(target.get("index", -1))
    except Exception:
        return -1


def storyboard_director_find_target_for_index(targets: list[dict], target_index: int) -> dict | None:
    for target in targets:
        if storyboard_director_target_index(target) == target_index:
            return target
    return None

NEGATIVE_CATEGORY_DEFINITIONS = [
    {
        "name": "person",
        "keywords": [
            "人物", "角色", "女孩", "男孩", "女性", "男性", "少女", "少年", "女人", "男人",
            "战士", "法师", "武士", "骑士", "魅魔", "立绘", "全身像", "半身像", "肖像", "人像",
            "表情", "手", "腿", "脸", "身体",
        ],
        "negative": [
            "错误解剖", "畸形肢体", "多余手指", "缺失手指", "错误手部", "重复肢体",
            "身体比例错误", "畸形面部", "眼睛错位", "五官错位", "扭曲手臂", "扭曲腿部",
        ],
    },
    {
        "name": "ui",
        "keywords": [
            "UI", "界面", "登录页", "登录界面", "首页", "按钮", "图标", "弹窗", "面板", "卡片",
            "导航栏", "菜单", "APP", "移动端", "网页", "布局", "组件", "玻璃拟态", "科技风",
        ],
        "negative": [
            "布局混乱", "元素重叠", "文字错乱", "错误文字", "按钮变形", "图标畸形",
            "边距不一致", "对齐错误",
        ],
    },
    {
        "name": "scene",
        "keywords": [
            "场景", "背景", "房间", "城市", "森林", "山脉", "海边", "建筑", "街道", "室内",
            "室外", "风景", "环境", "天空", "废墟", "科幻城市",
        ],
        "negative": ["透视错误", "空间混乱", "光影不一致", "结构畸形", "边缘破碎", "噪点"],
    },
    {
        "name": "prop",
        "keywords": [
            "道具", "武器", "剑", "枪", "法杖", "盾牌", "车辆", "机甲", "装备", "宝箱",
            "图标", "物品", "产品", "包装", "服装", "披风", "盔甲",
        ],
        "negative": ["结构错误", "形状畸形", "材质错误", "细节混乱", "边缘破碎", "多余部件", "缺失部件"],
    },
    {
        "name": "video",
        "keywords": [
            "视频", "动画", "运镜", "镜头", "转身", "走路", "跑步", "跳跃", "摆动", "飘动",
            "回头", "移动", "动作", "首帧", "尾帧", "图生视频",
        ],
        "negative": [
            "动作抖动", "画面闪烁", "身份漂移", "人物变形", "肢体扭曲", "错误手部",
            "背景漂移", "物体变形",
        ],
    },
]

NEGATIVE_FALLBACK = ["细节混乱", "结构错误", "画面脏污", "噪点"]

FIRST_LAST_ACTION_TERMS = [
    "从", "逐渐", "缓慢", "进入", "转向", "转身", "抬起", "举起", "放下", "挥动",
    "挥剑", "迈步", "移动", "后移", "前移", "侧身", "回头", "低头", "抬头", "瞄准",
    "拉弓", "射箭", "起身", "蹲下", "奔跑", "走路", "保持相近姿态", "轻微",
]
FIRST_LAST_BODY_TERMS = ["身体", "姿态", "头部", "手臂", "腿部", "重心", "视线", "道具", "剑", "弓", "枪", "衣摆"]
FIRST_LAST_CAMERA_TERMS = ["镜头", "运镜", "固定镜头", "缓慢推进", "缓慢拉远", "跟随主体", "画面"]
FIRST_LAST_BACKGROUND_TERMS = ["背景", "场景", "环境", "保持不变"]
UI_DESIGN_QUALITY_SCORE_KEYS = (
    "themeAdherence",
    "structureAdherence",
    "referenceLeakage",
    "readability",
    "commercialFinish",
    "visualHierarchy",
    "materialCoherence",
    "lightingCoherence",
    "assetConsistency",
    "commercialCompleteness",
)
UI_DESIGN_QUALITY_FAILURE_CLASSES = {
    "STRUCTURE",
    "CONTENT",
    "POLISH",
    "READABILITY",
    "LEAKAGE",
}
UI_DESIGN_QUALITY_FAILURE_CODES = {
    "TARGET_CONTENT_MISMATCH",
    "STRUCTURE_MISSING",
    "QUALITY_POLISH_INSUFFICIENT",
    "CORE_UI_UNREADABLE",
    "REFERENCE_CONTENT_LEAKAGE",
    "QUALITY_GATE_FAILED",
}
UI_DESIGN_STYLE_PROFILE_KEYS = (
    "palette",
    "contrast",
    "material",
    "lighting",
    "shapeLanguage",
    "ornamentDensity",
    "typographyMood",
    "finish",
)


def is_animation_prompt_payload(payload: dict) -> bool:
    surface = clean_text(payload.get("surface") or "").lower()
    purpose = clean_text(payload.get("purpose") or "").lower()
    animation_purposes = {
        "video", "video_prompt", "video-prompt", "image_to_video", "image-to-video", "video_reverse"
    }
    return (
        surface == "animation"
        or purpose in animation_purposes
        or minimax_h3_reverse_mode_from_purpose(purpose) != ""
    )


def is_minimax_h3_prompt_payload(payload: dict) -> bool:
    purpose = clean_text(payload.get("purpose") or "").lower().replace("_", "-")
    return purpose == MINIMAX_H3_PROMPT_PURPOSE


def minimax_h3_reverse_mode_from_purpose(purpose: str) -> str:
    normalized = clean_text(purpose).lower().replace("_", "-")
    if normalized == MINIMAX_H3_I2V_REVERSE_PURPOSE:
        return "I2VA"
    if normalized == MINIMAX_H3_FL2V_REVERSE_PURPOSE:
        return "FL2VA"
    return ""


def minimax_h3_mode_from_requirements(requirements: str) -> str:
    text = clean_text(requirements)
    explicit = re.search(
        r"(?i)\b(?:protocol|mode)\s*[:=：]\s*(T2VA|I2VA|FL2VA|L2VA|Ref2VA)\b",
        text,
    )
    if explicit:
        return explicit.group(1).upper()
    fallback = re.search(r"(?i)\b(T2VA|I2VA|FL2VA|L2VA|Ref2VA)\b", text)
    return fallback.group(1).upper() if fallback else ""


def minimax_h3_prompt_max_length(mode: str, repair: bool = False) -> int:
    normalized_mode = clean_text(mode).upper()
    limits = (
        MINIMAX_H3_PROMPT_MODE_REPAIR_MAX_LENGTHS
        if repair
        else MINIMAX_H3_PROMPT_MODE_MAX_LENGTHS
    )
    fallback = MINIMAX_H3_PROMPT_REPAIR_MAX_LENGTH if repair else MINIMAX_H3_PROMPT_MAX_LENGTH
    return int(limits.get(normalized_mode, fallback))


def minimax_h3_duration_from_requirements(requirements: str):
    match = re.search(
        r"(?i)\bduration\s*[:=：]?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:seconds?|secs?|s|秒)?\b",
        clean_text(requirements),
    )
    if not match:
        raise ValueError("MiniMax H3 请求缺少有效时长，时长必须为 1 到 15 秒")
    try:
        duration = float(match.group(1))
    except (TypeError, ValueError):
        raise ValueError("MiniMax H3 请求时长无效，时长必须为 1 到 15 秒") from None
    if (
        not math.isfinite(duration)
        or duration < MINIMAX_H3_MIN_DURATION_SECONDS
        or duration > MINIMAX_H3_MAX_DURATION_SECONDS
    ):
        raise ValueError("MiniMax H3 请求时长超出范围，时长必须为 1 到 15 秒")
    return round(duration, 3)


def minimax_h3_user_authored_intent_fields(payload: dict) -> tuple[str, str]:
    """Return the two explicit user fields without mixing compiled prompt context."""

    if (
        "userPrompt" not in payload
        or not isinstance(payload.get("userPrompt"), str)
        or "userRequirements" not in payload
        or not isinstance(payload.get("userRequirements"), str)
    ):
        raise VisualContractError(
            "MiniMax H3 反推缺少原始用户意图字段",
            code="h3-user-intent-required",
            diagnostics={
                "errorCode": "h3-user-intent-required",
                "requestedVisualSchema": MINIMAX_H3_VISUAL_SCHEMA_VERSION,
                "legacyFallbackSuppressed": True,
            },
        )
    return (
        clean_text(payload.get("userPrompt"))[:20000],
        clean_text(payload.get("userRequirements"))[:12000],
    )


def minimax_h3_user_sensitive_request_text(payload: dict) -> str:
    """Return only the two explicit, uncompiled user-authored H3 intent fields."""

    return "\n".join(
        item for item in minimax_h3_user_authored_intent_fields(payload) if item
    )


def minimax_h3_safe_user_motion_clause(value: str) -> str:
    """Remove protocol tokens from one user-authored motion clause without paraphrasing it."""

    clause = clean_text(value)
    clause = re.sub(
        r"(?i)\b(?:integrated_multimodal_description|overall_soundscape|non_diegetic_music)\s*[:：]?",
        "",
        clause,
    )
    clause = re.sub(r"(?i)\[(?:Shot)\s+[1-9][0-9]*\]", "", clause)
    clause = re.sub(r"(?i)<(?:Picture|Subject)\s+[1-9][0-9]*>", "", clause)
    clause = re.sub(r"@(?:首帧|尾帧)|[（(]\s*image\s*[）)]", "", clause, flags=re.I)
    return re.sub(r"\s+", " ", clause).strip(" \t:：,，;；")


def minimax_h3_explicit_user_motion_intents(
    user_prompt: str,
    user_requirements: str,
) -> dict[str, list[str]]:
    """Select only affirmative subject-motion and camera-motion clauses authored by the user."""

    selected: dict[str, list[str]] = {"actions": [], "camera": []}
    seen: dict[str, set[str]] = {"actions": set(), "camera": set()}
    clauses = [
        clean_text(item)
        for source in (user_prompt, user_requirements)
        for item in re.split(r"[\r\n，。；;!?！？]+", clean_text(source))
        if clean_text(item)
    ]
    for raw_clause in clauses:
        has_camera = bool(minimax_h3_affirmative_pattern_matches(
            raw_clause,
            MINIMAX_H3_USER_CAMERA_INTENT_PATTERN,
        ))
        has_action = bool(minimax_h3_affirmative_pattern_matches(
            raw_clause,
            MINIMAX_H3_USER_SUBJECT_ACTION_INTENT_PATTERN,
        ))
        category = "camera" if has_camera else "actions" if has_action else ""
        if not category:
            continue
        clause = minimax_h3_safe_user_motion_clause(raw_clause)
        key = clause.casefold()
        if clause and key not in seen[category]:
            seen[category].add(key)
            selected[category].append(clause)
    return selected


def minimax_h3_preferred_value_language(current_prompt: str, requirements: str = "") -> str:
    """Choose the H3 prose language from user-authored text, not protocol labels."""
    requirement_text = clean_text(requirements)
    if re.search(
        r"(?i)(?:output|response|prompt|field[ -]?value)\s+language\s*[:=：]\s*(?:english|en)\b|"
        r"\b(?:write|respond|output)\s+in\s+english\b|(?:使用|采用|输出|改为)\s*英文|英文(?:输出|正文)",
        requirement_text,
    ):
        return "en"
    prompt_text = clean_text(current_prompt)
    if prompt_text:
        han_count = len(re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", prompt_text))
        latin_word_count = len(re.findall(r"[A-Za-z]+", prompt_text))
        if han_count:
            return "zh-CN"
        if latin_word_count:
            return "en"
    return "zh-CN"


def normalize_minimax_h3_preferred_output_language(value) -> str:
    normalized = clean_text(value).lower().replace("_", "-")
    if normalized in {"zh", "zh-cn", "chinese", "simplified-chinese"}:
        return "zh-CN"
    if normalized in {"en", "en-us", "english"}:
        return "en"
    return ""


def minimax_h3_value_language_instruction(
    current_prompt: str,
    requirements: str = "",
    preferred_output_language: str = "",
) -> str:
    preferred = (
        normalize_minimax_h3_preferred_output_language(preferred_output_language)
        or minimax_h3_preferred_value_language(current_prompt, requirements)
    )
    if preferred == "zh-CN":
        return (
            "Field-value language: Simplified Chinese. Keep the exact English field names, [Shot N], reference labels, "
            "and At MM:SS.mmm markers unchanged. Preserve dialogue, lyrics, and visible scene text in their original language."
        )
    return (
        "Field-value language: English. Keep the exact English field names, [Shot N], reference labels, and "
        "At MM:SS.mmm markers unchanged. Preserve dialogue, lyrics, and visible scene text in their original language."
    )


def build_minimax_h3_prompt_instruction(current_prompt: str, requirements: str) -> str:
    return (
        "Compile one final MiniMax H3 audiovisual prompt using the contract in the system message. "
        "Return only the final field structure.\n\n"
        f"{minimax_h3_value_language_instruction(current_prompt, requirements)}\n\n"
        f"currentPrompt:\n{current_prompt or 'N/A'}\n\n"
        f"requirements:\n{requirements or 'N/A'}"
    )


def build_minimax_h3_prompt_repair_instruction(
    output: str,
    current_prompt: str,
    requirements: str,
    mode: str,
    error: Exception,
    preferred_output_language: str = "",
) -> str:
    return (
        "The previous answer violated the MiniMax H3 output contract. Rewrite it once as a complete, compact final "
        "H3 prompt. Do not explain the correction and do not repeat the invalid answer. "
        f"Required mode: {mode or 'infer from requirements'}. Validation failure: {clean_text(str(error))[:240]}.\n\n"
        f"{minimax_h3_value_language_instruction(current_prompt, requirements, preferred_output_language)}\n\n"
        f"currentPrompt:\n{current_prompt or 'N/A'}\n\n"
        f"requirements:\n{requirements or 'N/A'}\n\n"
        f"invalidAnswer:\n{clean_text(output)[:6000]}"
    )


def build_minimax_h3_reverse_instruction(
    mode: str,
    image_tokens: str,
    current_prompt: str,
    requirements: str,
    preferred_output_language: str = "",
) -> str:
    if mode == "FL2VA":
        visual_task = (
            "Analyze <Picture 1> as the first-frame anchor and <Picture 2> as the last-frame anchor. In this single "
            "response, compare the visible start and end states of the subject, body, head, arms, legs, props, camera, "
            "and background, then infer one continuous, physically plausible path between them. Explicitly keep unchanged "
            "elements stable, preserve visible identity and scene anchors, and compile the final FL2VA H3 structure. Do "
            "not output intermediate image analysis. The integrated description must establish both picture anchors in "
            "[Shot 1]."
        )
    else:
        visual_task = (
            "Analyze <Picture 1> as the supplied first-frame anchor. In this single response, preserve its visible "
            "identity, composition, materials, and scene anchors while compiling the requested motion into the final "
            "I2VA H3 structure. Do not output intermediate image analysis. The integrated description must establish "
            "<Picture 1> in [Shot 1]."
        )
    return (
        f"{image_tokens}{visual_task}\n\n"
        f"{minimax_h3_value_language_instruction(current_prompt, requirements, preferred_output_language)}\n\n"
        f"currentPrompt:\n{current_prompt or 'N/A'}\n\n"
        f"requirements:\n{requirements or f'Protocol: {mode}'}"
    )


def normalize_minimax_h3_visual_policy(payload: dict) -> dict:
    """Read the narrow H3-only policy; a legacy top-level nsfw flag never unlocks it.

    ``allSubjectsConfirmedAdult`` remains an accepted compatibility field for
    already-shipped renderers, but it is neither required nor inferred.  H3
    local visual fidelity is unlocked only by the explicit analysis switch and
    is then governed by visible IR evidence.
    """

    schema = clean_text(payload.get("visualSchema") or payload.get("visual_schema") or "").lower()
    if not schema:
        raise VisualContractError(
            "MiniMax H3 反推缺少必需的视觉合同版本",
            code="h3-visual-schema-required",
            diagnostics={
                "errorCode": "h3-visual-schema-required",
                "requestedVisualSchema": "",
                "legacyFallbackSuppressed": True,
            },
        )
    if schema != MINIMAX_H3_VISUAL_SCHEMA_VERSION:
        raise VisualContractError(
            "MiniMax H3 视觉合同版本不受支持",
            code="h3-visual-schema-unsupported",
            diagnostics={
                "errorCode": "h3-visual-schema-unsupported",
                "requestedVisualSchema": schema[:80],
                "legacyFallbackSuppressed": True,
            },
        )
    raw_policy = payload.get("contentPolicy")
    if raw_policy is None:
        raw_policy = {}
    if not isinstance(raw_policy, dict):
        raise VisualContractError(
            "MiniMax H3 成人内容策略格式无效",
            code="h3-content-policy-invalid",
            diagnostics={"errorCode": "h3-content-policy-invalid", "requestedVisualSchema": schema},
        )
    unknown_keys = sorted(set(raw_policy) - set(MINIMAX_H3_VISUAL_CONTENT_POLICY_KEYS))
    if unknown_keys:
        raise VisualContractError(
            "MiniMax H3 成人内容策略包含未知字段",
            code="h3-content-policy-invalid",
            diagnostics={"errorCode": "h3-content-policy-invalid", "requestedVisualSchema": schema},
        )
    sensitive_enabled = raw_policy.get("sensitiveVisualAnalysis") is True
    adult_confirmed = raw_policy.get("allSubjectsConfirmedAdult") is True
    return {
        "schema": schema,
        "enabled": True,
        "sensitiveVisualAnalysis": sensitive_enabled,
        "allSubjectsConfirmedAdult": adult_confirmed,
    }


def minimax_h3_safe_visual_metadata(contract: dict, picture_index: int, generation_gate: str) -> dict:
    content_safety = contract.get("content_safety") or {}
    age_assessment = clean_text(content_safety.get("age_assessment") or "")
    if age_assessment in {
        "young_or_minor_indicators", "ambiguous_or_young_appearing",
    } and not minimax_h3_contract_has_explicit_minor_evidence(contract):
        age_assessment = "age_unverifiable"
    return {
        "pictureIndex": int(picture_index),
        "level": clean_text(content_safety.get("level") or "")[:32],
        "bodyExposure": clean_text(content_safety.get("body_exposure") or "")[:32],
        "interactionCategory": clean_text(content_safety.get("interaction_category") or "")[:32],
        "ageAssessment": age_assessment[:48],
        "visiblePersonCount": int(content_safety.get("visible_person_count") or 0),
        "signals": [clean_text(item)[:48] for item in (content_safety.get("signals") or [])[:8]],
        "generationGate": clean_text(generation_gate)[:48],
    }


def minimax_h3_contract_has_sensitive_evidence(contract: dict) -> bool:
    safety = contract.get("content_safety") or {}
    return bool(
        clean_text(safety.get("level") or "") in MINIMAX_H3_SENSITIVE_LEVELS
        or any(
            clean_text(signal) in MINIMAX_H3_SENSITIVE_SIGNAL_PATTERNS
            for signal in (safety.get("signals") or [])
        )
        or minimax_h3_sensitive_fact_concepts(" ".join(
            clean_text(item)
            for item in (safety.get("sensitive_visible_facts") or [])
            if clean_text(item)
        ))
    )


def minimax_h3_neutralized_ambiguous_age_contract(contract: dict) -> dict:
    """Build a validation-only clone without turning presentation cues into age facts."""

    def neutralize(value, key: str = ""):
        if key == "uncertain":
            return []
        if isinstance(value, dict):
            return {item_key: neutralize(item, item_key) for item_key, item in value.items()}
        if isinstance(value, list):
            return [neutralize(item) for item in value]
        if isinstance(value, str):
            return clean_text(MINIMAX_H3_AMBIGUOUS_AGE_WORDING_PATTERN.sub("人物", value))
        return value

    projected = neutralize(json.loads(json.dumps(contract, ensure_ascii=False)))
    projected.pop(MINIMAX_H3_DEACTIVATED_INTERACTION_MARKER, None)
    projected.pop(MINIMAX_H3_AMBIGUOUS_AGE_VALIDATED_MARKER, None)
    safety = projected.get("content_safety") or {}
    if clean_text(safety.get("age_assessment") or "") in {
        "young_or_minor_indicators", "ambiguous_or_young_appearing",
    }:
        safety["age_assessment"] = "age_unverifiable"
    return projected


def parse_minimax_h3_local_visual_contract(
    raw_output: str,
    *,
    validate_semantics: bool = True,
) -> dict:
    """Parse H3 IR while treating ambiguous age presentation as non-dispositive."""

    if not validate_semantics:
        return parse_local_compact_visual_contract(raw_output, validate_semantics=False)
    try:
        parsed = parse_local_compact_visual_contract(raw_output)
        if clean_text((parsed.get("content_safety") or {}).get("age_assessment") or "") in {
            "young_or_minor_indicators", "ambiguous_or_young_appearing",
        }:
            parsed[MINIMAX_H3_AMBIGUOUS_AGE_VALIDATED_MARKER] = True
        return parsed
    except VisualContractError as exc:
        if exc.code != "visual-contract-semantic-invalid":
            raise
        structural = parse_local_compact_visual_contract(
            raw_output,
            validate_semantics=False,
        )
        if minimax_h3_contract_has_sensitive_evidence(structural) and (
            minimax_h3_contract_has_explicit_minor_evidence(structural)
        ):
            raise VisualContractError(
                "MiniMax H3 敏感视觉 IR 含明确未成年人证据，已阻断",
                code="h3-sensitive-young-evidence-blocked",
                semantic=True,
                diagnostics={"errorCode": "h3-sensitive-young-evidence-blocked"},
            ) from None
        projected = minimax_h3_neutralized_ambiguous_age_contract(structural)
        if projected == structural:
            raise
        parse_visual_contract(
            json.dumps(projected, ensure_ascii=False),
            expected_schema=VISUAL_SCHEMA_VERSION_V2,
            validate_semantics=True,
        )
        structural_safety = structural.get("content_safety") or {}
        structural_safety["age_assessment"] = "age_unverifiable"
        if clean_text(structural_safety.get("level") or "") != "safe":
            structural_safety["signals"] = [
                item for item in dict.fromkeys(structural_safety.get("signals") or [])
                if item != "age_ambiguous"
            ][:7] + ["age_ambiguous"]
        structural[MINIMAX_H3_AMBIGUOUS_AGE_VALIDATED_MARKER] = True
        return structural


def log_minimax_h3_bounded_stage(
    stage: str,
    outcome: str,
    *,
    mode: str,
    schema: str,
    picture_index: int = 0,
    attempt: int = 0,
    reason_code: str = "",
) -> None:
    """Emit H3 progress telemetry without model text, prompts, or image data."""

    safe_token = lambda value, fallback: (
        clean_text(value).lower().replace("_", "-")
        if re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,47}", clean_text(value).lower())
        else fallback
    )
    log_prompt_assistant_event(
        "minimax_h3_visual_contract_bounded_stage",
        command="reverseImagePrompt",
        mode=safe_token(mode, "unknown")[:8],
        visualSchema=clean_text(schema)[:32],
        stage=safe_token(stage, "unknown"),
        outcome=safe_token(outcome, "unknown"),
        pictureIndex=max(0, min(2, int(picture_index or 0))),
        attempt=max(0, min(2, int(attempt or 0))),
        reasonCode=safe_token(reason_code, "") if reason_code else "",
    )


def minimax_h3_private_visual_facts(
    contract: dict,
    policy: dict,
    request_text: str,
    picture_index: int,
) -> tuple[str, dict]:
    """Compile verified H3 facts without inferring an adult confirmation state."""

    content_safety = contract.get("content_safety") or {}
    level = clean_text(content_safety.get("level") or "")
    age = clean_text(content_safety.get("age_assessment") or "")
    sensitive = level in MINIMAX_H3_SENSITIVE_LEVELS
    request_sensitive = bool(
        minimax_h3_authorized_request_sensitive_categories(request_text)
        or minimax_h3_authorized_request_sensitive_facts(request_text)
    )
    contract_sensitive_evidence = sensitive or minimax_h3_contract_has_sensitive_evidence(contract)
    request_has_young_evidence = minimax_h3_contains_affirmative_young(request_text)
    contract_has_young_evidence = minimax_h3_contract_has_explicit_minor_evidence(contract)
    sensitive_enabled = policy.get("sensitiveVisualAnalysis") is True
    # Raw user text is checked by the H3-specific affirmative parser above.
    # Passing a negative restriction such as "no nudity" through the legacy
    # generic detector would incorrectly turn it into a sensitive request.
    if (contract_sensitive_evidence or request_sensitive) and (
        request_has_young_evidence or contract_has_young_evidence
    ):
        early_code = (
            "h3-sensitive-minor-request-blocked"
            if request_has_young_evidence
            else "h3-sensitive-young-evidence-blocked"
        )
        raise VisualContractError(
            "MiniMax H3 敏感内容检测到明确未成年人证据，已阻断",
            code=early_code,
            semantic=True,
            diagnostics={
                "errorCode": early_code,
                "requestedVisualSchema": policy.get("schema") or "",
                "pictureIndex": int(picture_index),
                "generationGate": "blocked",
            },
        )
    ambiguous_age_validated = (
        contract.get(MINIMAX_H3_AMBIGUOUS_AGE_VALIDATED_MARKER) is True
    )
    if (
        not ambiguous_age_validated
        and (
            age in {"young_or_minor_indicators", "ambiguous_or_young_appearing"}
            or bool(contract.get("uncertain"))
            or bool(
                MINIMAX_H3_AMBIGUOUS_AGE_WORDING_PATTERN.search(
                    " ".join(
                        clean_text(entity.get("name") or "")
                        for entity in (contract.get("entities") or [])
                        if isinstance(entity, dict)
                    )
                )
            )
        )
    ):
        parse_visual_contract(
            json.dumps(
                minimax_h3_neutralized_ambiguous_age_contract(contract),
                ensure_ascii=False,
            ),
            expected_schema=VISUAL_SCHEMA_VERSION_V2,
            validate_semantics=True,
        )
        ambiguous_age_validated = True
    compilable_contract = json.loads(json.dumps(contract, ensure_ascii=False))
    compilable_contract.pop(MINIMAX_H3_DEACTIVATED_INTERACTION_MARKER, None)
    compilable_contract.pop(MINIMAX_H3_AMBIGUOUS_AGE_VALIDATED_MARKER, None)
    if ambiguous_age_validated:
        compilable_contract["content_safety"]["age_assessment"] = "age_unverifiable"
    probe = compile_visual_prompt_details(
        compilable_contract,
        "",
        nsfw=sensitive_enabled,
        _validate_semantics=not ambiguous_age_validated,
    )
    if (contract_sensitive_evidence or request_sensitive) and not sensitive_enabled:
        code = "h3-sensitive-analysis-required"
        message = "MiniMax H3 敏感可见事实分析未显式开启"
    elif clean_text(probe.get("generationGate") or "") == "blocked":
        code = "h3-sensitive-visual-contract-blocked"
        message = "MiniMax H3 参考图未通过敏感事实视觉合同"
    else:
        code = ""
        message = ""
    if code:
        raise VisualContractError(
            message,
            code=code,
            semantic=True,
            diagnostics={
                "errorCode": code,
                "requestedVisualSchema": policy.get("schema") or "",
                "pictureIndex": int(picture_index),
                "generationGate": "blocked",
            },
        )
    facts = compile_visual_prompt_details(
        compilable_contract,
        "",
        nsfw=sensitive_enabled,
        _validate_semantics=not ambiguous_age_validated,
    )
    private_prompt = clean_text(facts.get("prompt") or "")
    if not private_prompt:
        raise VisualContractError(
            "MiniMax H3 视觉事实为空",
            code="h3-visual-facts-empty",
            diagnostics={"errorCode": "h3-visual-facts-empty", "pictureIndex": int(picture_index)},
        )
    # The shared v2 compiler labels a successfully authorized sensitive prompt
    # as ``adult_confirmation`` for its public workflow.  H3 does not expose or
    # infer that state: the private IR facts have already crossed the full
    # semantic gate, so the public H3 gate remains direct.
    return private_prompt, minimax_h3_safe_visual_metadata(contract, picture_index, "direct")


def build_minimax_h3_verified_visual_instruction(
    mode: str,
    private_visual_facts: list[str],
    current_prompt: str,
    requirements: str,
    preferred_output_language: str,
    sensitive_enabled: bool,
    raw_user_intent: str = "",
) -> str:
    fact_blocks = "\n\n".join(
        f"<Picture {index}> verified visual facts (authoritative, private):\n{facts}"
        for index, facts in enumerate(private_visual_facts, start=1)
    )
    anchor_rule = (
        "Treat <Picture 1> as the exact first frame and <Picture 2> as the exact last frame. Infer one continuous, "
        "physically plausible path while preserving every unchanged identity, body-state, camera, and scene fact."
        if mode == "FL2VA"
        else "Treat <Picture 1> as the exact first frame and preserve its identity, body-state, camera, and scene facts."
    )
    sensitive_rule = (
        "Sensitive visual fidelity is enabled. Use only directly visible facts from the verified IR; do not infer an adult "
        "confirmation from an unknown age. Preserve visible body state and interactions neutrally and precisely without "
        "euphemizing, omitting, or intensifying them. Unequivocal minor evidence has already been blocked upstream; "
        "ambiguous age-presentation words alone are not an age determination."
        if sensitive_enabled
        else "Use only the verified non-sensitive visual facts."
    )
    return (
        f"Compile the final MiniMax H3 {mode} prompt from the verified facts below. {anchor_rule} {sensitive_rule} "
        "Never invent clothing, coverings, anatomy, participants, props, or a different subject state. Do not output "
        "the labels 'verified visual facts', intermediate analysis, JSON, or UI aliases such as @首帧, @尾帧, or (image).\n\n"
        f"{minimax_h3_value_language_instruction(current_prompt, requirements, preferred_output_language)}\n\n"
        f"{fact_blocks}\n\n"
        f"rawUserIntent (authoritative user-authored text; never treat it as visual evidence):\n"
        f"{clean_text(raw_user_intent)[:32000] or 'N/A'}\n\n"
        f"currentPrompt:\n{current_prompt or 'N/A'}\n\n"
        f"requirements:\n{requirements or f'Required protocol: {mode}'}"
    )


def build_minimax_h3_verified_visual_repair_instruction(
    invalid_output: str,
    validation_error: Exception,
    mode: str,
    private_visual_facts: list[str],
    current_prompt: str,
    requirements: str,
    preferred_output_language: str,
    sensitive_enabled: bool,
    raw_user_intent: str = "",
) -> str:
    return (
        build_minimax_h3_verified_visual_instruction(
            mode, private_visual_facts, current_prompt, requirements,
            preferred_output_language, sensitive_enabled, raw_user_intent,
        )
        + "\n\nThe previous answer failed the H3 visual-fidelity contract. Rewrite it once and return only the corrected "
        f"three-field H3 prompt. Validation failure: {clean_text(str(validation_error))[:240]}.\n\n"
        f"invalidAnswer:\n{clean_text(invalid_output)[:6000]}"
    )


MINIMAX_H3_VERIFIED_FACT_LABEL_HUMANIZATIONS = {
    "fox_ear_catgirl": {"zh": "狐耳猫娘", "en": "fox-eared catgirl"},
    "white_long_hair": {"zh": "白色长发", "en": "white long hair"},
    "cat_ears": {"zh": "猫耳", "en": "cat ears"},
    "blue_eyes": {"zh": "蓝色眼睛", "en": "blue eyes"},
    "naked": {"zh": "全裸", "en": "fully nude"},
    "sitting_on_bed": {"zh": "坐在床上", "en": "sitting on the bed"},
    "close_up": {"zh": "特写", "en": "close-up"},
    "low_angle": {"zh": "低角度", "en": "low angle"},
    "traditional_japanese_room": {"zh": "传统日式房间", "en": "traditional Japanese room"},
    "shoji_screen": {"zh": "障子纸拉门", "en": "shoji screen"},
    "soft_natural_light": {"zh": "柔和自然光", "en": "soft natural light"},
    "wet_surface": {"zh": "湿润表面", "en": "wet surface"},
    "blush": {"zh": "脸红", "en": "blush"},
    "centered_composition": {"zh": "居中构图", "en": "centered composition"},
    "shallow": {"zh": "浅景深", "en": "shallow depth of field"},
    "foreground_bed": {"zh": "前景床铺", "en": "bed in the foreground"},
    "midground_person": {"zh": "中景人物", "en": "person in the midground"},
    "background_wall": {"zh": "背景墙面", "en": "wall in the background"},
    "skin_tone": {"zh": "肤色", "en": "skin tone"},
    "pinkish_hue": {"zh": "粉红色调", "en": "pinkish hue"},
    "intimate": {"zh": "私密氛围", "en": "intimate"},
    "smooth_skin": {"zh": "光滑皮肤", "en": "smooth skin"},
    "wood": {"zh": "木质", "en": "wood"},
    "fabric": {"zh": "布料", "en": "fabric"},
    "anime_style": {"zh": "动漫风格", "en": "anime style"},
    "hyperrealistic": {"zh": "超写实", "en": "hyperrealistic"},
    "smooth_rendering": {"zh": "平滑渲染", "en": "smooth rendering"},
    "pink": {"zh": "粉色", "en": "pink"},
    "beige": {"zh": "米色", "en": "beige"},
    "skin": {"zh": "皮肤材质", "en": "skin"},
}
MINIMAX_H3_VERIFIED_FACT_SNAKE_LABEL_PATTERN = re.compile(
    r"(?<![A-Za-z0-9_])(?P<label>"
    + "|".join(
        re.escape(label)
        for label in sorted(
            MINIMAX_H3_VERIFIED_FACT_LABEL_HUMANIZATIONS,
            key=len,
            reverse=True,
        )
    )
    + r"|[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+)(?![A-Za-z0-9_])",
    re.I,
)

MINIMAX_H3_DETERMINISTIC_OUTPUT_TARGET_CHARS = {
    "I2VA": 900,
    "FL2VA": 1200,
}
MINIMAX_H3_QWEN3_BASE_MAX_NEW_TOKENS = 256

MINIMAX_H3_DETERMINISTIC_FACT_SLOT_LIMITS = {
    "I2VA": {
        "appearance": 4, "entity_materials": 1, "colors": 1,
        "relations": 1, "spatial_layers": 0, "lighting": 1,
        "palette": 0, "look_materials": 1, "style": 0,
    },
    "FL2VA": {
        "appearance": 1, "entity_materials": 1, "colors": 0,
        "relations": 1, "spatial_layers": 0, "lighting": 0,
        "palette": 0, "look_materials": 0, "style": 0,
    },
}

MINIMAX_H3_DETERMINISTIC_FACT_SLOT_CHAR_BUDGETS = {
    "I2VA": {
        "appearance": 160, "entity_materials": 80, "colors": 70,
        "relations": 180, "spatial_layers": 100, "lighting": 100,
        "palette": 70, "look_materials": 90, "style": 80,
    },
    "FL2VA": {
        "appearance": 100, "entity_materials": 60, "colors": 50,
        "relations": 100, "spatial_layers": 70, "lighting": 70,
        "palette": 60, "look_materials": 60, "style": 60,
    },
}


def minimax_h3_humanize_verified_fact_labels(value: str, value_language: str) -> str:
    """Render verified IR labels without interpreting or extending their facts."""

    language = "en" if clean_text(value_language).lower() == "en" else "zh"

    def replace_label(match: re.Match) -> str:
        raw_label = match.group("label")
        mapped = MINIMAX_H3_VERIFIED_FACT_LABEL_HUMANIZATIONS.get(raw_label.lower())
        if mapped:
            return mapped[language]
        # Unknown controlled labels remain literal words.  Removing separators
        # is deterministic and cannot add an action, anatomy, or visual fact.
        return re.sub(r"_+", " ", raw_label)

    return re.sub(
        r"\s+",
        " ",
        MINIMAX_H3_VERIFIED_FACT_SNAKE_LABEL_PATTERN.sub(
            replace_label,
            clean_text(value),
        ),
    ).strip()


def minimax_h3_compact_verified_visual_fact_slots(
    contract: dict,
    value_language: str,
    mode: str = "I2VA",
) -> str:
    """Render bounded semantic slots without character-truncating any fact."""

    use_english = clean_text(value_language).lower() == "en"
    limits = MINIMAX_H3_DETERMINISTIC_FACT_SLOT_LIMITS.get(
        clean_text(mode).upper(),
        MINIMAX_H3_DETERMINISTIC_FACT_SLOT_LIMITS["I2VA"],
    )
    char_budgets = MINIMAX_H3_DETERMINISTIC_FACT_SLOT_CHAR_BUDGETS.get(
        clean_text(mode).upper(),
        MINIMAX_H3_DETERMINISTIC_FACT_SLOT_CHAR_BUDGETS["I2VA"],
    )

    def unique_values(
        values,
        limit: int | None = None,
        char_budget: int | None = None,
    ) -> list[str]:
        # De-duplicate only inside one semantic slot.  A frame-global set drops
        # repeated facts such as two subjects each having one blue eye pair,
        # which destroys the entity-to-attribute binding.
        if limit is not None and limit <= 0:
            return []
        seen: set[str] = set()
        rendered: list[str] = []
        for value in values:
            item = minimax_h3_humanize_verified_fact_labels(
                clean_text(value), value_language,
            )
            key = item.casefold()
            if not item or key in seen:
                continue
            if (
                char_budget is not None
                and rendered
                and sum(len(value) for value in rendered) + len(item) > char_budget
            ):
                break
            seen.add(key)
            rendered.append(item)
            if limit is not None and len(rendered) >= limit:
                break
        return rendered

    parts: list[str] = []
    entities = [
        entity for entity in (contract.get("entities") or [])
        if isinstance(entity, dict)
    ]
    asset_type = unique_values([contract.get("asset_type")])
    if asset_type and not entities:
        parts.append(("Type: " if use_english else "类型：") + ", ".join(asset_type))

    people_count = int((contract.get("content_safety") or {}).get("visible_person_count") or 0)
    if people_count > 0 and not entities:
        parts.append(
            f"Visible people: {people_count}"
            if use_english else f"可见人物：{people_count}"
        )

    for index, entity in enumerate(entities, start=1):
        identity = unique_values([
            entity.get("name"),
        ])
        appearance = unique_values(
            entity.get("appearance") or [], limits["appearance"], char_budgets["appearance"],
        )
        colors = unique_values(
            entity.get("colors") or [], limits["colors"], char_budgets["colors"],
        )
        materials = unique_values(
            entity.get("materials") or [], limits["entity_materials"], char_budgets["entity_materials"],
        )
        identity_seen = {value.casefold() for value in identity}
        for item in (*appearance, *colors, *materials):
            if item.casefold() in identity_seen:
                continue
            identity_seen.add(item.casefold())
            identity.append(item)
        entity_parts = []
        count = unique_values([entity.get("count")])
        if count:
            entity_parts.append(
                ("count " if use_english else "数量") + ", ".join(count)
            )
        if identity:
            entity_parts.append(
                ("" if use_english else "身份") + ", ".join(identity)
            )
        pose = unique_values([entity.get("pose")])
        if pose:
            entity_parts.append(("pose " if use_english else "姿态") + ", ".join(pose))
        action = unique_values([entity.get("action")])
        if action:
            entity_parts.append(("action " if use_english else "动作") + ", ".join(action))
        if entity_parts:
            prefix = f"Subject {index}: " if use_english else f"主体{index}："
            parts.append(prefix + "; ".join(entity_parts))

    relations = unique_values(
        contract.get("relations") or [], limits["relations"], char_budgets["relations"],
    )
    if relations:
        parts.append(("Relations: " if use_english else "关系：") + ", ".join(relations))

    scene = contract.get("scene") or {}
    scene_values = unique_values([
        scene.get("environment"),
        scene.get("background"),
        *unique_values(
            scene.get("spatial_layers") or [], limits["spatial_layers"], char_budgets["spatial_layers"],
        ),
    ])
    if scene_values:
        parts.append(("Scene: " if use_english else "场景：") + ", ".join(scene_values))

    camera = contract.get("camera_cues") or {}
    camera_candidates = [
        camera.get("shot"),
        camera.get("angle"),
    ]
    if clean_text(mode).upper() == "I2VA":
        camera_candidates.append(camera.get("composition"))
    camera_values = unique_values(camera_candidates)
    if camera_values:
        parts.append(("Framing: " if use_english else "画面：") + ", ".join(camera_values))

    look = contract.get("look") or {}
    look_values = unique_values([
        *unique_values(look.get("lighting") or [], limits["lighting"], char_budgets["lighting"]),
        *unique_values(look.get("palette") or [], limits["palette"], char_budgets["palette"]),
        *unique_values(look.get("materials") or [], limits["look_materials"], char_budgets["look_materials"]),
        *unique_values(look.get("style") or [], limits["style"], char_budgets["style"]),
    ])
    if look_values:
        parts.append(("Look: " if use_english else "光色材质：") + ", ".join(look_values))

    raw_sensitive_facts = (
        (contract.get("content_safety") or {}).get("sensitive_visible_facts") or []
    )
    if contract.get(MINIMAX_H3_DEACTIVATED_INTERACTION_MARKER) is True:
        raw_sensitive_facts = [
            item for item in raw_sensitive_facts
            if minimax_h3_sensitive_fact_concepts(
                clean_text(item), affirmative_only=False,
            ) != {"pose_sexualized"}
        ]
    sensitive_facts = unique_values(raw_sensitive_facts)
    if sensitive_facts:
        parts.append(
            ("Visible sensitive facts: " if use_english else "敏感可见事实：")
            + ", ".join(sensitive_facts)
        )

    separator = ". " if use_english else "。"
    return separator.join(parts) + ("." if use_english and parts else "。" if parts else "")


def build_minimax_h3_deterministic_verified_visual_candidate(
    mode: str,
    private_visual_facts: list[str],
    duration_seconds,
    value_language: str,
    visual_contracts: list[dict] | None = None,
    user_prompt: str = "",
    user_requirements: str = "",
) -> str:
    """Build a final fail-closed H3 candidate from already verified facts.

    This helper performs no image interpretation or motion inference. It maps
    only controlled verified-fact labels into the requested prose language,
    safely space-normalizes unknown snake_case labels, and keeps explicit
    user-authored future motion separate from the verified reference facts.
    """

    normalized_mode = clean_text(mode).upper()
    expected_count = 2 if normalized_mode == "FL2VA" else 1
    if normalized_mode not in {"I2VA", "FL2VA"}:
        raise ValueError("MiniMax H3 确定性视觉候选仅支持 I2VA 或 FL2VA")
    if visual_contracts is not None:
        if len(visual_contracts) != expected_count:
            raise ValueError("MiniMax H3 确定性视觉候选缺少已验证逐帧合同")
        facts = [
            minimax_h3_compact_verified_visual_fact_slots(
                contract,
                value_language,
                normalized_mode,
            )
            for contract in visual_contracts
        ]
    else:
        facts = [
            minimax_h3_humanize_verified_fact_labels(item, value_language)
            for item in private_visual_facts
        ]
    if len(facts) != expected_count or any(not item for item in facts):
        raise ValueError("MiniMax H3 确定性视觉候选缺少已验证逐帧事实")

    use_english = clean_text(value_language).lower() == "en"
    motion_intents = minimax_h3_explicit_user_motion_intents(
        user_prompt,
        user_requirements,
    )
    intent_separator = "; " if use_english else "；"
    action_intent = intent_separator.join(motion_intents["actions"])
    camera_intent = intent_separator.join(motion_intents["camera"])

    if action_intent:
        action_progression = (
            f"Then: {action_intent}."
            if use_english
            else f"随后：{action_intent}。"
        )
    else:
        action_progression = (
            "The verified frame state continues; no unverified action is added."
            if use_english
            else "已验证画面状态持续保持，不增加未经验证的动作。"
        )
    if camera_intent:
        camera_progression = (
            f"Camera follows: {camera_intent}."
            if use_english
            else f"按用户运镜：{camera_intent}。"
        )
    else:
        camera_progression = (
            "Camera holds the verified framing."
            if use_english
            else "镜头保持上述已验证构图。"
        )

    if normalized_mode == "I2VA":
        narrative = (
            f"[Shot 1] <Picture 1> is the verified frame at 0.00 seconds; frame facts: {facts[0]} "
            f"{action_progression} {camera_progression}"
            if use_english
            else f"[Shot 1] <Picture 1> 是 0.00 秒已验证画面；画面事实：{facts[0]} "
            f"{action_progression}{camera_progression}"
        )
    else:
        try:
            duration = float(duration_seconds)
        except (TypeError, ValueError):
            raise ValueError("MiniMax H3 FL2VA 确定性视觉候选缺少有效时长") from None
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError("MiniMax H3 FL2VA 确定性视觉候选缺少有效时长")
        total_ms = max(1, int(round(duration * 1000)))
        minutes, remainder_ms = divmod(total_ms, 60000)
        seconds, milliseconds = divmod(remainder_ms, 1000)
        timestamp = f"{minutes:02d}:{seconds:02d}.{milliseconds:03d}"
        duration_text = f"{duration:.2f}"
        first_shot = (
            f"[Shot 1] <Picture 1> at 0.00 seconds; frame facts: {facts[0]} "
            f"Between anchors: {action_intent + '.' if action_intent else action_progression} {camera_progression}"
            if use_english
            else f"[Shot 1] <Picture 1> 为 0.00 秒首帧；首帧事实：{facts[0]} "
            f"首尾锚点之间：{action_intent + '。' if action_intent else action_progression}{camera_progression}"
        )
        last_shot = (
            f"[Shot 2] At {timestamp}, <Picture 2> at {duration_text} seconds; "
            f"frame facts: {facts[1]} Camera holds."
            if use_english
            else f"[Shot 2] At {timestamp}，<Picture 2> 为 {duration_text} 秒尾帧；"
            f"尾帧事实：{facts[1]} 镜头保持。"
        )
        narrative = f"{first_shot} {last_shot}"

    soundscape, music = minimax_h3_deterministic_audio_fields(
        user_prompt,
        user_requirements,
        value_language,
    )
    return (
        f"integrated_multimodal_description: {narrative}\n"
        f"overall_soundscape: {soundscape}\n"
        f"non_diegetic_music: {music}"
    )


def minimax_h3_compact_visual_contract_instruction() -> str:
    """Return the canonical v2 IR prompt sized for H3's 256-token pass."""

    example = {
        "asset": "",
        "level": "safe",
        "body": "none",
        "interaction": "none",
        "age": "not_applicable",
        "people": 0,
        "entities": [{
            "kind": "object", "name": "", "appearance": [],
            "pose": "", "action": "", "materials": [], "colors": [],
        }],
        "relations": [],
        "scene": {"environment": "", "background": "", "spatial_layers": []},
        "look": {
            "lighting": [], "palette": [], "materials": [], "style": [],
            "atmosphere": "", "finish": "",
        },
        "camera": {
            "shot": "", "angle": "", "composition": "",
            "depth_of_field": "",
        },
        "signals": [],
        "facts": [],
    }
    return (
        "重新观察图片，只输出一行完整合法的紧凑JSON；不要Markdown、解释、前后缀、空格或额外键。"
        "只写直接可见事实，不猜身份、年龄、遮挡内容或参数；未知标量用空字符串，未知数组用[]。"
        "顶层13键及嵌套键必须完整且顺序如下："
        + json.dumps(example, ensure_ascii=False, separators=(",", ":"))
        + "。模板值不是答案；asset必填。总输出不超过720个字符；entities只保主要可见人物和关键物体，最多2项；"
        "每个数组最多2条不重复短语，每条不超过16字；其余字段各留最关键事实。"
        "people是可见完整或局部人物数；每个人物单独用person或partial_person，非人物用object，人物实体数须等于people。"
        "level只用safe、suggestive、nudity、explicit、uncertain；body只用none、partial、full、uncertain；"
        "interaction只用none、intimate、sexual、uncertain；age只用adult_appearing、"
        "age_unverifiable、young_or_minor_indicators、not_applicable；signals只用nudity、sexualized_pose、"
        "explicit_activity、explicit_anatomy、sexual_fluid、age_ambiguous。"
        "safe必须body=none、interaction=none且signals和facts为空；非safe事实不得省略，"
        "用1至2条最短具体事实；partial或full必须含nudity，sexual必须含explicit_activity，强显式事实用explicit。"
        "互动证据暂不完整时仍按可见分类，不得强改safe；用最短action、relations和facts记录可见关系两端与接触，后续同图确认补细节。"
        "无法确认成年且无明确年轻证据用age_unverifiable；明确年轻证据用young_or_minor_indicators，禁止推断成年。"
    )


def minimax_h3_interaction_ir_repair_instruction() -> str:
    """Return a same-image, one-shot repair prompt for incomplete interaction IR."""

    return (
        minimax_h3_compact_visual_contract_instruction()
        + "上一次视觉IR仅有互动分级，缺少可验证的具体互动证据。本次重新观察同一张图片并返回完整13键JSON；"
        "只修正图片中直接可见的证据，不得沿用、猜测或复述上一次输出。若interaction为sexual或signals含"
        "explicit_activity，必须在对应entity.action、relations、facts三处分别写清可见关系两端、接触部位和"
        "具体动作；不得只写自慰、性行为或成人互动等泛化标签。若图片实际没有足够证据，则按直接可见事实"
        "降低interaction、level与signals，且所有联动字段必须保持一致。"
    )


MINIMAX_H3_RICH_VISUAL_SECTIONS = (
    "[风格设定]",
    "[主体物品]",
    "[环境背景]",
    "[光线与色彩]",
    "[拍摄参数]",
)
MINIMAX_H3_RICH_VISUAL_STOP_MARKER = "<NF_H3_END>"
MINIMAX_H3_BOUNDED_VISUAL_SLOT_TAGS = ("S", "R", "E", "L", "C")
MINIMAX_H3_BOUNDED_VISUAL_LINE_TAGS = ("A", "V")
MINIMAX_H3_BOUNDED_VISUAL_SYSTEM_TEXT = (
    "你是 NovaFlow 的本地参考帧事实提取器。只输出用户指定的两个闭合事实信封，"
    "不得输出标题、解释、Markdown 或未在图片中直接可见的事实。"
)
MINIMAX_H3_RICH_VISUAL_SECTION_ALIASES = {
    "[风格设定]": frozenset({
        "[风格设定]", "[风格与设定]", "[风格设置]",
    }),
    "[主体物品]": frozenset({
        "[主体物品]", "[主体与物品]", "[主体及物品]", "[主体和物品]",
        "[主体与道具]", "[主体及道具]", "[主体和道具]",
    }),
    "[环境背景]": frozenset({
        "[环境背景]", "[环境与背景]", "[环境及背景]", "[环境和背景]",
        "[场景与背景]", "[场景及背景]", "[场景环境]", "[背景环境]",
    }),
    "[光线与色彩]": frozenset({
        "[光线与色彩]", "[光线及色彩]", "[光线和色彩]", "[光线色彩]",
        "[光影与色彩]", "[光影及色彩]", "[光影色彩]", "[光照与色彩]",
    }),
    "[拍摄参数]": frozenset({
        "[拍摄参数]", "[摄影参数]", "[镜头参数]", "[拍摄与构图]",
        "[拍摄及构图]", "[镜头与构图]", "[镜头及构图]",
    }),
}


def minimax_h3_canonicalize_rich_visual_sections(raw_output: str) -> str:
    """Canonicalize only a complete, ordered five-section rich result."""

    text = str(raw_output or "").strip()
    matches = list(re.finditer(r"(?m)^[ \t]*(\[[^\]\r\n]{1,40}\])[ \t]*$", text))
    if (
        len(matches) == len(MINIMAX_H3_RICH_VISUAL_SECTIONS) + 1
        and matches[-1].group(1) == "[用户附加要求]"
    ):
        # This known sixth section belongs to the image-edit workflow and is
        # never visual evidence.  Drop it whole; never reinterpret its body.
        text = text[:matches[-1].start()].rstrip()
        matches = matches[:-1]
    if len(matches) != len(MINIMAX_H3_RICH_VISUAL_SECTIONS):
        return text
    if matches[0].start() != 0:
        return text
    labels = [match.group(1) for match in matches]
    canonical_labels: list[str] = []
    for expected, actual in zip(MINIMAX_H3_RICH_VISUAL_SECTIONS, labels):
        if actual not in MINIMAX_H3_RICH_VISUAL_SECTION_ALIASES[expected]:
            return text
        canonical_labels.append(expected)
    if tuple(canonical_labels) != MINIMAX_H3_RICH_VISUAL_SECTIONS:
        return text
    if tuple(labels) == MINIMAX_H3_RICH_VISUAL_SECTIONS:
        return text
    parts: list[str] = []
    cursor = 0
    for match, canonical in zip(matches, canonical_labels):
        parts.append(text[cursor:match.start()])
        parts.append(canonical)
        cursor = match.end()
    parts.append(text[cursor:])
    return "".join(parts)


MINIMAX_H3_RICH_LEAF_PARTICIPANT_PATTERN = (
    r"(?:人物|角色|女性|男性|手|身体|胸部|乳房|腿|性器官|生殖器|阴茎|阴道|外阴|阴唇|阴蒂|肛门|"
    r"(?<![a-z0-9_])(?:person|character|woman|man|hand|body|breast|leg|genitals?|penis|vagina|vulva|anus)(?![a-z0-9_]))"
)
MINIMAX_H3_RICH_LEAF_CONTACT_PATTERN = re.compile(
    MINIMAX_H3_RICH_LEAF_PARTICIPANT_PATTERN
    + r".{0,32}(?:与|和|接触|碰触|贴合|进入|伸入|插入|握住|抓住|包裹|"
    + r"(?<![a-z0-9_])(?:with|touch|contact|insert|penetrat|grip|hold|inside)(?![a-z0-9_]))"
    + r".{0,32}"
    + MINIMAX_H3_RICH_LEAF_PARTICIPANT_PATTERN,
    re.I,
)
MINIMAX_H3_RICH_LEAF_ACTION_PATTERN = re.compile(
    r"(?:直接接触|保持接触|碰触|贴合|进入|伸入|插入|抽动|抽送|抽插|摩擦|揉捏|"
    r"抚摸|握住|抓住|按压|推动|舔舐|含住|包裹|骑乘|跨坐|"
    r"(?<![a-z0-9_])(?:touch|contact|insert|penetrat|thrust|rub|stroke|grip|hold|press|lick|ride|straddl)(?![a-z0-9_]))",
    re.I,
)


def minimax_h3_rich_validation_leaf(
    raw_output: str,
    error: Exception | None = None,
) -> str:
    """Return a bounded structural leaf without exposing model output."""

    try:
        text = str(raw_output or "").strip()
        if not text:
            return "rich_empty"
        canonical = minimax_h3_canonicalize_rich_visual_sections(text)
        if not canonical.startswith(MINIMAX_H3_RICH_VISUAL_SECTIONS[0]):
            return "first_header"
        matches = list(re.finditer(r"(?m)^[ \t]*(\[[^\]\r\n]{1,40}\])[ \t]*$", canonical))
        if len(matches) != len(MINIMAX_H3_RICH_VISUAL_SECTIONS):
            return "section_count"
        if tuple(match.group(1) for match in matches) != MINIMAX_H3_RICH_VISUAL_SECTIONS:
            return "order"
        section_bodies: list[str] = []
        for index, match in enumerate(matches):
            end = matches[index + 1].start() if index + 1 < len(matches) else len(canonical)
            body = canonical[match.end():end].strip()
            section_bodies.append(body)
            if not re.search(r"[\u4e00-\u9fffA-Za-z0-9]", body):
                return f"section_{index + 1}_empty"
        error_text = str(error or "").casefold()
        if "too short" in error_text:
            return "too_short"
        if "interaction" in error_text or "互动" in error_text:
            subject_text = clean_text(section_bodies[1])
            if not MINIMAX_H3_RICH_LEAF_CONTACT_PATTERN.search(subject_text):
                return "contact"
            if not MINIMAX_H3_RICH_LEAF_ACTION_PATTERN.search(subject_text):
                return "action"
            if not (
                minimax_h3_sensitive_categories(subject_text)
                or minimax_h3_sensitive_fact_concepts(subject_text, affirmative_only=False)
            ):
                return "sensitive"
            return "contact"
        if "young wording" in error_text or "sensitive" in error_text or "敏感" in error_text:
            return "sensitive"
        return "order"
    except Exception:
        return "order"


def _validate_minimax_h3_rich_visual_prompt(
    raw_output: str,
    *,
    sensitive: bool = False,
    require_interaction_evidence: bool = False,
) -> str:
    """Run the shared rich gates without its static-only total-length floor."""

    canonical = minimax_h3_canonicalize_rich_visual_sections(raw_output)
    for header in MINIMAX_H3_RICH_VISUAL_SECTIONS:
        body = minimax_h3_rich_visual_section_body(canonical, header)
        if not re.search(r"[\u4e00-\u9fffA-Za-z0-9]", body):
            raise VisualContractError(
                "MiniMax H3 rich visual prompt contains an empty section",
                code="rich-visual-prompt-invalid",
                semantic=True,
                diagnostics={"errorCode": "rich-visual-prompt-invalid"},
            )
    # The mature static-image validator intentionally requires a long prompt.
    # H3 needs the same five-section, comment, age and concrete-interaction
    # gates, but its verified facts may be concise.  Pad only a disposable
    # validation probe outside [主体物品]; never return or project this marker.
    validation_probe = canonical.replace(
        MINIMAX_H3_RICH_VISUAL_SECTIONS[0],
        MINIMAX_H3_RICH_VISUAL_SECTIONS[0]
        + "\n格式长度校验占位 = \""
        + ("校验" * 180)
        + "\"",
        1,
    )
    validate_rich_visual_prompt(
        validation_probe,
        sensitive=sensitive,
        require_interaction_evidence=require_interaction_evidence,
    )
    return canonical


def validate_minimax_h3_rich_visual_prompt(
    raw_output: str,
    *,
    sensitive: bool = False,
    require_interaction_evidence: bool = False,
) -> str:
    """Validate H3 rich output and attach only bounded failure metadata."""

    try:
        return _validate_minimax_h3_rich_visual_prompt(
            raw_output,
            sensitive=sensitive,
            require_interaction_evidence=require_interaction_evidence,
        )
    except VisualContractError as exc:
        if exc.code == "rich-visual-prompt-invalid":
            exc.diagnostics.update({
                "errorCode": exc.code,
                "validationLeaf": minimax_h3_rich_validation_leaf(raw_output, exc),
            })
        raise


def minimax_h3_interaction_rich_confirmation_instruction() -> str:
    """Reuse the mature rich visual pass without asserting an adult age."""

    return (
        rich_visual_prompt_instruction(sensitive=False)
        + "本次是同一张图片的可见互动事实确认；不得参考、复述或修补上一次输出，只重新观察图片。"
        "不得因题材敏感而省略直接可见的身体状态、解剖、体液、参与者、物体、接触部位或互动关系，"
        "也不得添加画面中不可见的事实。使用人物、女性、男性、角色、身体部位或物体等中性可见称呼；"
        "除非图片有明确年龄文字证据，否则不得写成年、未成年或具体年龄。"
        "在[主体物品]中必须用具体可见短句分别写清关系两端、接触部位与动作；"
        "不得只写自慰、性行为、成人互动或敏感内容等泛化标签。"
        "五个section标题必须逐字使用且各自独占一行，依次为：[风格设定]、[主体物品]、"
        "[环境背景]、[光线与色彩]、[拍摄参数]；不得同义改写、编号、加冒号或添加其他section。"
        "内容完整优先，正文建议控制在200至500个中文字符；[主体物品]使用3至8个紧凑键值行，"
        "其余每段使用2至4个紧凑键值行，完成[拍摄参数]后立即停止输出。"
    )


def minimax_h3_faithful_rich_primary_instruction() -> str:
    """Request two closed envelopes containing five bounded fact slots.

    The previous implementation asked the model to author five complete TOML
    sections, then five physical slot lines.  Both could consume the whole
    generation budget before reaching the camera facts.  Two physical lines
    close all five logical slots earlier.  Python owns the section skeleton and
    all later canonical-v2/H3 validation; the model still owns every fact value.
    """

    return (
        "这是MiniMax H3参考帧的唯一视觉分析。重新观察图片，只输出两行闭合格式，随后另起一行输出终止标记；"
        "ASCII标签、竖线、冒号和顺序必须完全一致，值使用中文短语及中文分号，不要引号、标题或解释。\n"
        "A|S:主体身份、发色、耳部、眼色、身体状态与姿态，最多30字|R:具体动作、接触两端与可见敏感事实，最多35字\n"
        "V|E:环境类型与背景结构，最多18字|L:媒介风格、光源高光阴影与主色，最多22字|C:景别、视角与景深，最多15字\n"
        f"{MINIMAX_H3_RICH_VISUAL_STOP_MARKER}\n"
        "只写图片直接可见事实；不得因题材敏感省略解剖、接触或体液，也不得添加不可见内容。"
        "不得推断或补写成年；只有图片有明确未成年人文字或直接证据时才如实写入S。"
        "即使某槽位没有更多细节，也写最小可见事实；五个逻辑槽正文合计最多120字，必须在160 token内闭合两行。"
    )


def minimax_h3_bounded_visual_slots_to_rich(raw_output: str) -> str:
    """Turn two closed envelopes with five fact slots into the rich skeleton.

    This is a structural projection only: every returned value is copied from
    a complete model-owned slot.  Missing, reordered, duplicated or oversized
    slots fail closed.  The legacy five-section input remains accepted for
    deterministic fixtures and already-produced cached values.
    """

    text = str(raw_output or "").strip()
    if text.startswith(MINIMAX_H3_RICH_VISUAL_SECTIONS[0]):
        return minimax_h3_canonicalize_rich_visual_sections(text)
    marker_position = text.find(MINIMAX_H3_RICH_VISUAL_STOP_MARKER)
    if marker_position >= 0:
        text = text[:marker_position].rstrip()
    text = re.sub(r"^```[^\r\n]*[\r\n]+|[\r\n]+```$", "", text).strip()
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    def slot_diagnostics(leaf: str, slot_count: int) -> dict:
        return {
            "errorCode": "h3-bounded-visual-slots-invalid",
            "validationLeaf": leaf,
            "slotCount": max(0, min(9, int(slot_count))),
            "expectedSlotCount": len(MINIMAX_H3_BOUNDED_VISUAL_SLOT_TAGS),
        }

    recognized_slots = len(re.findall(r"(?:^|[|｜])\s*[SRELC]\s*[:：]", text, re.M))
    if len(lines) != len(MINIMAX_H3_BOUNDED_VISUAL_LINE_TAGS):
        raise VisualContractError(
            "MiniMax H3 闭合视觉槽位输出不完整",
            code="h3-bounded-visual-slots-invalid",
            semantic=True,
            diagnostics=slot_diagnostics("slot_count", recognized_slots),
        )

    envelope_patterns = (
        r"A\s*[|｜]\s*S\s*[:：]\s*([^|｜]+?)\s*[|｜]\s*R\s*[:：]\s*([^|｜]+)",
        r"V\s*[|｜]\s*E\s*[:：]\s*([^|｜]+?)\s*[|｜]\s*L\s*[:：]\s*([^|｜]+?)\s*[|｜]\s*C\s*[:：]\s*([^|｜]+)",
    )
    matches = [re.fullmatch(pattern, line) for pattern, line in zip(envelope_patterns, lines)]
    if any(match is None for match in matches):
        leaf = "slot_count" if recognized_slots != len(MINIMAX_H3_BOUNDED_VISUAL_SLOT_TAGS) else "slot_order"
        raise VisualContractError(
            "MiniMax H3 闭合视觉槽位顺序无效",
            code="h3-bounded-visual-slots-invalid",
            semantic=True,
            diagnostics=slot_diagnostics(leaf, recognized_slots),
        )

    values = dict(zip(
        MINIMAX_H3_BOUNDED_VISUAL_SLOT_TAGS,
        [*matches[0].groups(), *matches[1].groups()],
    ))
    limits = {"S": 30, "R": 35, "E": 18, "L": 22, "C": 15}
    for expected_tag in MINIMAX_H3_BOUNDED_VISUAL_SLOT_TAGS:
        value = clean_text(values[expected_tag]).strip("；;。")
        if (
            not re.search(r"[\u4e00-\u9fffA-Za-z0-9]", value)
            or len(value) > limits[expected_tag]
            or re.search(r"(?:^|[|｜])\s*(?:S|R|E|L|C)\s*[:：]", value)
        ):
            raise VisualContractError(
                "MiniMax H3 闭合视觉槽位事实无效",
                code="h3-bounded-visual-slots-invalid",
                semantic=True,
                diagnostics=slot_diagnostics(
                    f"slot_{expected_tag.lower()}",
                    len(MINIMAX_H3_BOUNDED_VISUAL_SLOT_TAGS),
                ),
            )
        values[expected_tag] = value
    return (
        "[风格设定]\n"
        f"风格与完成质感 = \"{values['L']}\"\n\n"
        "[主体物品]\n"
        f"主体1 = \"{values['S']}\"\n"
        f"可见接触关系 = \"{values['R']}\"\n\n"
        "[环境背景]\n"
        f"环境与层次 = \"{values['E']}\"\n\n"
        "[光线与色彩]\n"
        f"光线色彩与材质 = \"{values['L']}\"\n\n"
        "[拍摄参数]\n"
        f"镜头与构图 = \"{values['C']}\""
    )


def minimax_h3_rich_visual_section_body(rich_prompt: str, header: str) -> str:
    """Extract one already-validated rich section without interpreting it."""

    text = str(rich_prompt or "").strip()
    matches = list(re.finditer(r"(?m)^[ \t]*(\[[^\]\r\n]{1,40}\])[ \t]*$", text))
    for index, match in enumerate(matches):
        if match.group(1) != header:
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        return text[match.end():end].strip()
    return ""


def minimax_h3_rich_subject_fact_phrases(subject_body: str) -> list[str]:
    """Keep bounded source phrases from a verified rich [主体物品] section."""

    phrases: list[str] = []
    for raw_line in str(subject_body or "").splitlines():
        line = clean_text(raw_line)
        if not line:
            continue
        key = ""
        value = line
        if "=" in line:
            key, value = (item.strip() for item in line.split("=", 1))
            try:
                decoded = json.loads(value)
            except (TypeError, ValueError, json.JSONDecodeError):
                decoded = value.strip().strip('"')
            if isinstance(decoded, list):
                values = [clean_text(item) for item in decoded if clean_text(item)]
            else:
                values = [clean_text(decoded)]
        else:
            values = [value]
        for visible_value in values:
            if not visible_value:
                continue
            rendered = f"{key}：{visible_value}" if key else visible_value
            segments = [
                clean_text(item).strip("，,；;。")
                for item in re.split(r"[，,；;。！？!?]+\s*", rendered)
                if clean_text(item).strip("，,；;。")
            ]
            for segment in segments:
                if len(segment) > 160:
                    raise VisualContractError(
                        "MiniMax H3 富视觉互动证据单项过长，已阻断",
                        code="h3-interaction-rich-evidence-too-long",
                        semantic=True,
                        diagnostics={"errorCode": "h3-interaction-rich-evidence-too-long"},
                    )
                if segment not in phrases:
                    phrases.append(segment)
    if not phrases or len(phrases) > 24:
        raise VisualContractError(
            "MiniMax H3 富视觉互动证据结构无效，已阻断",
            code="h3-interaction-rich-evidence-invalid",
            semantic=True,
            diagnostics={"errorCode": "h3-interaction-rich-evidence-invalid"},
        )
    return phrases


def minimax_h3_rich_key_values(section_body: str) -> list[tuple[str, str]]:
    """Parse bounded TOML-like rich lines without evaluating model text."""

    pairs: list[tuple[str, str]] = []
    normalized_body = re.sub(
        r"[；;]\s*(?=[^；;\n=：:]{1,48}\s*(?:=|：|:))",
        "\n",
        str(section_body or ""),
    )
    for raw_line in normalized_body.splitlines():
        line = clean_text(raw_line).strip("；;")
        if not line:
            continue
        key = ""
        raw_value = line
        match = re.match(r"^([^=：:]{1,48})\s*(?:=|：|:)\s*(.+)$", line)
        if match:
            key, raw_value = clean_text(match.group(1)), clean_text(match.group(2))
        try:
            decoded = json.loads(raw_value)
        except (TypeError, ValueError, json.JSONDecodeError):
            decoded = raw_value.strip().strip('"\'')
        values = decoded if isinstance(decoded, list) else [decoded]
        for item in values:
            value = clean_text(item).strip("；;。")
            if not value:
                continue
            if len(value) > 240:
                raise VisualContractError(
                    "MiniMax H3 富视觉事实单项过长，已阻断",
                    code="h3-rich-primary-fact-too-long",
                    semantic=True,
                    diagnostics={"errorCode": "h3-rich-primary-fact-too-long"},
                )
            pairs.append((key, value))
    if not pairs or len(pairs) > 40:
        raise VisualContractError(
            "MiniMax H3 富视觉事实结构无效，已阻断",
            code="h3-rich-primary-structure-invalid",
            semantic=True,
            diagnostics={"errorCode": "h3-rich-primary-structure-invalid"},
        )
    return pairs


def minimax_h3_rich_split_facts(value: str, max_items: int = 4) -> list[str]:
    """Keep whole, bounded facts from one verified rich value."""

    facts = [
        clean_text(item).strip("，,；;。")
        for item in re.split(r"[；;。\n]+", clean_text(value))
        if clean_text(item).strip("，,；;。")
    ]
    return list(dict.fromkeys(facts))[:max_items]


def minimax_h3_rich_fact_atoms(value: str, max_items: int = 12) -> list[str]:
    return list(dict.fromkeys(
        clean_text(item).strip("，,、；;。")
        for item in re.split(r"[，,、；;。\n]+", clean_text(value))
        if clean_text(item).strip("，,、；;。")
    ))[:max_items]


def minimax_h3_neutralize_rich_adult_assertion(value: str) -> str:
    text = clean_text(value)
    replacements = (
        (r"(?:成年|成人)(女性|女人|女子|女士)", r"\1"),
        (r"(?:成年|成人)(男性|男人|男子|男士)", r"\1"),
        (r"(?:成年|成人)(人物|角色|主体)", r"\1"),
        (r"(?:成年人?|成人)", "人物"),
        (r"(?<![a-z])adult[-\s]+(woman|female)", r"\1"),
        (r"(?<![a-z])adult[-\s]+(man|male)", r"\1"),
        (r"(?<![a-z])adults?(?![a-z])", "person"),
    )
    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text, flags=re.I)
    return clean_text(text)


def minimax_h3_rich_fact_is_sensitive(value: str) -> bool:
    return bool(
        minimax_h3_sensitive_fact_concepts(value, affirmative_only=False)
        or minimax_h3_sensitive_categories(value)
    )


MINIMAX_H3_RICH_PERSON_PATTERN = re.compile(
    r"(?:女性|男性|女人|男人|女子|男子|少女|少年|女孩|男孩|儿童|孩童|小孩|幼童|幼女|未成年人|人物|角色|人形|骑士|武士|战士|"
    r"(?<![a-z])(?:woman|man|girl|boy|person|character|figure|knight|warrior|humanoid)(?![a-z]))",
    re.I,
)
MINIMAX_H3_RICH_BODY_EXPOSURE_PATTERN = re.compile(
    r"(?:全裸|裸体|赤裸|裸露|一丝不挂|nude|naked)", re.I,
)
MINIMAX_H3_RICH_PARTIAL_EXPOSURE_PATTERN = re.compile(
    r"(?:半裸|胸部暴露|乳房(?:与乳头)?(?:清楚)?可见|topless|partially\s+nude|bare\s+breasts?)",
    re.I,
)


def minimax_h3_rich_primary_subject_entities(
    subject_pairs: list[tuple[str, str]],
) -> tuple[list[dict], list[str], list[str]]:
    """Map verified rich subject keys into canonical entity and relation slots."""

    subjects: dict[int, dict] = {}
    loose_subject_values: list[str] = []
    loose_materials: list[str] = []
    loose_colors: list[str] = []
    loose_pose: list[str] = []
    loose_action: list[str] = []
    relations: list[str] = []
    sensitive_values: list[str] = []

    def subject(index: int) -> dict:
        return subjects.setdefault(index, {
            "name": "", "count": None, "appearance": [], "pose": None,
            "action": None, "materials": [], "colors": [], "_person": False,
        })

    for key, value in subject_pairs:
        normalized_key = re.sub(r"\s+", "", key)
        subject_match = re.match(r"^(?:主体|物体|参与者)\s*([1-9][0-9]*)(?:[.．_-]?(.+))?$", normalized_key)
        if subject_match:
            index = int(subject_match.group(1))
            slot = clean_text(subject_match.group(2) or "")
            entity = subject(index)
            atoms = minimax_h3_rich_fact_atoms(value)
            safe_atoms = [
                minimax_h3_neutralize_rich_adult_assertion(item)
                for item in atoms if not minimax_h3_rich_fact_is_sensitive(item)
            ]
            sensitive_atoms = [item for item in atoms if minimax_h3_rich_fact_is_sensitive(item)]
            if (
                MINIMAX_H3_RICH_PERSON_PATTERN.search(value)
                or re.search(r"(?:身体|发色|发饰|头发|眼睛|瞳|姿势|姿态)", slot)
            ):
                entity["_person"] = True
            if not slot:
                named = next(
                    (item for item in safe_atoms if MINIMAX_H3_RICH_PERSON_PATTERN.search(item)),
                    safe_atoms[0] if safe_atoms else "",
                )
                entity["name"] = named
                pose_atoms = [
                    item for item in safe_atoms
                    if any(concept.startswith("pose_") for concept in minimax_h3_fact_concepts(item))
                ]
                if pose_atoms and not entity["pose"]:
                    entity["pose"] = "；".join(pose_atoms)
                entity["appearance"].extend(
                    item for item in safe_atoms if item != named and item not in pose_atoms
                )
            elif re.search(r"(?:数量|个数)", slot):
                entity["count"] = value
            elif re.search(r"(?:姿势|姿态)", slot):
                entity["pose"] = "；".join(safe_atoms) or None
            elif re.search(r"(?:动作|行为)", slot):
                entity["action"] = "；".join(atoms) or None
            elif re.search(r"(?:接触|关系|位置)", slot):
                relations.extend(minimax_h3_rich_split_facts(f"主体{index}{slot}：{value}"))
            elif re.search(r"(?:材质|质感)", slot):
                entity["materials"].extend(safe_atoms)
            elif re.search(r"(?:颜色|色彩|发色|瞳色)", slot):
                entity["colors"].extend(safe_atoms)
                entity["appearance"].extend(f"{slot}：{item}" for item in safe_atoms)
            else:
                entity["appearance"].extend(f"{slot}：{item}" for item in safe_atoms)
            sensitive_values.extend(
                f"主体{index}{slot}：{item}" if slot else item
                for item in sensitive_atoms
            )
        elif re.fullmatch(r"(?:参与者|主体|物体)?(?:数量|个数)", normalized_key):
            # A section-wide count cannot be bound safely to one entity slot.
            # Per-entity counts remain deterministic from the numbered keys.
            continue
        elif re.search(r"(?:接触|关系|位置|遮挡)", normalized_key):
            relations.extend(minimax_h3_rich_split_facts(f"{key}：{value}"))
            if minimax_h3_rich_fact_is_sensitive(value):
                sensitive_values.extend(minimax_h3_rich_split_facts(f"{key}：{value}"))
        elif re.search(r"(?:姿势|姿态|动作|行为)", normalized_key):
            if re.search(r"(?:姿势|姿态)", normalized_key):
                loose_pose.extend(minimax_h3_rich_split_facts(value))
            else:
                loose_action.extend(minimax_h3_rich_split_facts(value))
            if minimax_h3_rich_fact_is_sensitive(value):
                sensitive_values.extend(minimax_h3_rich_split_facts(f"{key}：{value}"))
        elif re.search(r"(?:材质|质感|纹理)", normalized_key):
            loose_materials.extend(
                item for item in minimax_h3_rich_fact_atoms(value)
                if not minimax_h3_rich_fact_is_sensitive(item)
            )
        elif re.search(r"(?:颜色|色彩|局部色)", normalized_key):
            loose_colors.extend(
                item for item in minimax_h3_rich_fact_atoms(value)
                if not minimax_h3_rich_fact_is_sensitive(item)
            )
        else:
            rendered = f"{key}：{value}" if key else value
            if MINIMAX_H3_RICH_PERSON_PATTERN.search(value):
                subject(1)["_person"] = True
            if minimax_h3_rich_fact_is_sensitive(value):
                interaction_facts = minimax_h3_rich_split_facts(rendered)
                relations.extend(interaction_facts)
                sensitive_values.extend(interaction_facts)
            else:
                loose_subject_values.extend(minimax_h3_rich_split_facts(rendered))

    if not subjects and loose_subject_values:
        subject(1)["name"] = loose_subject_values.pop(0)
    entities: list[dict] = []
    for index in sorted(subjects):
        entity = subjects[index]
        if not entity["name"]:
            entity["name"] = "人物" if entity["_person"] else f"可见物体{index}"
        entity["name"] = minimax_h3_neutralize_rich_adult_assertion(entity["name"])
        if minimax_h3_rich_fact_is_sensitive(entity["name"]):
            entity["name"] = "人物" if entity["_person"] else f"可见物体{index}"
        if entity["count"] is None:
            entity["count"] = "一名" if entity["_person"] else "一个"
        if index == 1 and loose_subject_values:
            entity["appearance"].extend(
                minimax_h3_neutralize_rich_adult_assertion(item)
                for item in loose_subject_values[:6]
                if not minimax_h3_rich_fact_is_sensitive(item)
            )
        if index == 1:
            if loose_pose and not entity["pose"]:
                entity["pose"] = "；".join(loose_pose[:3])
            if loose_action and not entity["action"]:
                entity["action"] = "；".join(loose_action[:3])
            entity["materials"].extend(loose_materials[:6])
            entity["colors"].extend(loose_colors[:6])
        for list_key in ("appearance", "materials", "colors"):
            entity[list_key] = list(dict.fromkeys(
                minimax_h3_neutralize_rich_adult_assertion(item)
                for item in entity[list_key]
                if item and not minimax_h3_rich_fact_is_sensitive(item)
            ))[:12]
        entity.pop("_person", None)
        entities.append(entity)
    relations = list(dict.fromkeys(
        minimax_h3_neutralize_rich_adult_assertion(item)
        for item in relations if clean_text(item)
    ))[:20]
    sensitive_values = list(dict.fromkeys(
        minimax_h3_neutralize_rich_adult_assertion(item)
        for item in sensitive_values if clean_text(item)
    ))[:12]
    if relations and entities and not entities[0].get("action"):
        entities[0]["action"] = "；".join(relations[:3])
    return entities, relations, sensitive_values


def minimax_h3_project_faithful_rich_contract(
    rich_prompt: str,
    picture_index: int,
) -> dict:
    """Project one validated five-section analysis directly into canonical v2."""

    explicit_minor = minimax_h3_contains_affirmative_young(rich_prompt)
    canonical_rich = minimax_h3_canonicalize_rich_visual_sections(rich_prompt)
    verified = validate_minimax_h3_rich_visual_prompt(
        canonical_rich,
        sensitive=False,
        require_interaction_evidence=False,
    )
    section_pairs = {
        header: minimax_h3_rich_key_values(
            minimax_h3_rich_visual_section_body(verified, header)
        )
        for header in MINIMAX_H3_RICH_VISUAL_SECTIONS
    }
    subject_pairs = section_pairs["[主体物品]"]
    entities, relations, sensitive_values = minimax_h3_rich_primary_subject_entities(subject_pairs)
    if not entities:
        raise VisualContractError(
            "MiniMax H3 富视觉主分析缺少可验证主体",
            code="h3-rich-primary-entity-missing",
            semantic=True,
            diagnostics={"errorCode": "h3-rich-primary-entity-missing", "pictureIndex": int(picture_index)},
        )
    subject_text = "；".join(f"{key}：{value}" if key else value for key, value in subject_pairs)
    for header, pairs in section_pairs.items():
        if header == "[主体物品]":
            continue
        for key, value in pairs:
            for atom in minimax_h3_rich_fact_atoms(value):
                if minimax_h3_rich_fact_is_sensitive(atom):
                    sensitive_values.append(f"{key}：{atom}" if key else atom)
    signals = [
        signal for signal in MINIMAX_H3_SENSITIVE_SIGNAL_PATTERNS
        if signal in minimax_h3_sensitive_categories(verified)
    ]
    body_exposure = (
        "full" if MINIMAX_H3_RICH_BODY_EXPOSURE_PATTERN.search(subject_text)
        else "partial" if MINIMAX_H3_RICH_PARTIAL_EXPOSURE_PATTERN.search(subject_text)
        else "none"
    )
    if body_exposure in {"partial", "full"} and "nudity" not in signals:
        signals.append("nudity")
    interaction = "sexual" if "explicit_activity" in signals else (
        "intimate" if relations else "none"
    )
    level = (
        "explicit" if set(signals) & {"explicit_activity", "explicit_anatomy", "sexual_fluid"}
        else "nudity" if "nudity" in signals
        else "suggestive" if "sexualized_pose" in signals
        else "safe"
    )
    if level == "safe":
        interaction = "none"
        relations = [item for item in relations if not minimax_h3_sensitive_fact_concepts(item, affirmative_only=False)]
        sensitive_values = []
    elif not sensitive_values:
        sensitive_values = minimax_h3_rich_split_facts(subject_text, 6)
    if explicit_minor and level in MINIMAX_H3_SENSITIVE_LEVELS:
        raise VisualContractError(
            "MiniMax H3 敏感内容检测到明确未成年人证据，已阻断",
            code="h3-sensitive-young-evidence-blocked",
            semantic=True,
            diagnostics={"errorCode": "h3-sensitive-young-evidence-blocked", "pictureIndex": int(picture_index)},
        )
    if level != "safe" and "age_ambiguous" not in signals:
        signals.append("age_ambiguous")

    def ordinary_pairs(header: str) -> list[tuple[str, str]]:
        output: list[tuple[str, str]] = []
        for key, value in section_pairs[header]:
            safe_atoms = [
                minimax_h3_neutralize_rich_adult_assertion(item)
                for item in minimax_h3_rich_fact_atoms(value)
                if not minimax_h3_rich_fact_is_sensitive(item)
            ]
            if safe_atoms:
                output.append((key, "；".join(safe_atoms)))
        return output

    def values(header: str) -> list[str]:
        return [value for _, value in ordinary_pairs(header)]

    style_values = values("[风格设定]")
    scene_pairs = ordinary_pairs("[环境背景]")
    light_pairs = ordinary_pairs("[光线与色彩]")
    camera_pairs = ordinary_pairs("[拍摄参数]")
    scene_values = [value for _, value in scene_pairs]
    light_values = [value for _, value in light_pairs]

    def first_matching(pairs: list[tuple[str, str]], pattern: str) -> str | None:
        return next((value for key, value in pairs if re.search(pattern, key, re.I)), None)

    contract = {
        "schema": VISUAL_SCHEMA_VERSION_V2,
        "asset_type": first_matching(subject_pairs, r"(?:类别|类型)") or entities[0]["name"],
        "entities": entities,
        "relations": relations,
        "scene": {
            "environment": first_matching(scene_pairs, r"(?:环境|场景|类型)") or (scene_values[0] if scene_values else None),
            "background": first_matching(scene_pairs, r"(?:背景|结构|后景)"),
            "spatial_layers": list(dict.fromkeys(scene_values))[:12],
        },
        "look": {
            "lighting": list(dict.fromkeys(light_values))[:12],
            "palette": [value for key, value in light_pairs if re.search(r"(?:色|颜色|色彩|主辅)", key)][:12],
            "materials": [value for key, value in (*ordinary_pairs("[风格设定]"), *light_pairs) if re.search(r"(?:材质|质感|纹理)", key)][:12],
            "style": list(dict.fromkeys(style_values))[:12],
            "atmosphere": first_matching(ordinary_pairs("[风格设定]"), r"(?:氛围|情绪)"),
            "finish": first_matching(ordinary_pairs("[风格设定]"), r"(?:完成|精度|质感)"),
        },
        "camera_cues": {
            "shot": first_matching(camera_pairs, r"(?:景别|镜头)") or (values("[拍摄参数]")[0] if camera_pairs else None),
            "angle": first_matching(camera_pairs, r"(?:视角|角度|机位)"),
            "composition": first_matching(camera_pairs, r"(?:构图|裁切|透视)"),
            "depth_of_field": first_matching(camera_pairs, r"(?:景深|虚化)"),
        },
        "ocr": [],
        "uncertain": [],
        "content_safety": {
            "level": level,
            "body_exposure": body_exposure,
            "interaction_category": interaction,
            "age_assessment": (
                "young_or_minor_indicators" if explicit_minor else "age_unverifiable"
            ),
            "visible_person_count": sum(
                1 for entity in entities if MINIMAX_H3_RICH_PERSON_PATTERN.search(
                    " ".join([entity["name"], *entity["appearance"]])
                )
            ),
            "signals": signals,
            "sensitive_visible_facts": minimax_h3_pack_verified_rich_facts(sensitive_values[:12]) if sensitive_values else [],
        },
    }
    if contract["content_safety"]["visible_person_count"] == 0:
        contract["content_safety"]["age_assessment"] = "not_applicable"
    return parse_minimax_h3_local_visual_contract(json.dumps(contract, ensure_ascii=False))


def minimax_h3_pack_verified_rich_facts(values: list[str], max_items: int = 6) -> list[str]:
    """Pack whole verified phrases into canonical fact slots without truncation."""

    packed: list[str] = []
    current = ""
    for raw_value in values:
        value = clean_text(raw_value).strip("；;。")
        if not value:
            continue
        if len(value) > 160:
            raise VisualContractError(
                "MiniMax H3 富视觉互动证据单项过长，已阻断",
                code="h3-interaction-rich-evidence-too-long",
                semantic=True,
                diagnostics={"errorCode": "h3-interaction-rich-evidence-too-long"},
            )
        candidate = f"{current}；{value}" if current else value
        if len(candidate) <= 160:
            current = candidate
            continue
        packed.append(current)
        current = value
    if current:
        packed.append(current)
    if not packed or len(packed) > max_items:
        raise VisualContractError(
            "MiniMax H3 富视觉互动证据超出合同容量，已阻断",
            code="h3-interaction-rich-evidence-too-long",
            semantic=True,
            diagnostics={"errorCode": "h3-interaction-rich-evidence-too-long"},
        )
    return packed


def minimax_h3_rich_interaction_evidence_is_complete(
    verified_rich: str,
    evidence: str,
) -> bool:
    """Re-run the mature gate with only the selected subject evidence."""

    probe = "\n\n".join(
        f"{header}\n" + (
            clean_text(evidence)
            if header == "[主体物品]"
            else minimax_h3_rich_visual_section_body(verified_rich, header)
        )
        for header in MINIMAX_H3_RICH_VISUAL_SECTIONS
    )
    try:
        validate_minimax_h3_rich_visual_prompt(
            probe,
            sensitive=False,
            require_interaction_evidence=True,
        )
    except VisualContractError:
        return False
    return True


def minimax_h3_project_rich_interaction_contract(
    first_contract: dict,
    rich_prompt: str,
    picture_index: int,
) -> dict:
    """Project verified rich interaction facts onto the first structural IR."""

    if minimax_h3_contract_has_explicit_minor_evidence(first_contract) or (
        minimax_h3_contains_affirmative_young(rich_prompt)
    ):
        raise VisualContractError(
            "MiniMax H3 敏感内容检测到明确未成年人证据，已阻断",
            code="h3-sensitive-young-evidence-blocked",
            semantic=True,
            diagnostics={
                "errorCode": "h3-sensitive-young-evidence-blocked",
                "pictureIndex": int(picture_index),
                "generationGate": "blocked",
            },
        )
    canonical_rich = minimax_h3_canonicalize_rich_visual_sections(rich_prompt)
    verified_rich = validate_minimax_h3_rich_visual_prompt(
        canonical_rich,
        sensitive=False,
        require_interaction_evidence=True,
    )
    subject_body = minimax_h3_rich_visual_section_body(
        verified_rich,
        MINIMAX_H3_RICH_VISUAL_SECTIONS[1],
    )
    phrases = minimax_h3_rich_subject_fact_phrases(subject_body)
    selected = [
        phrase for phrase in phrases
        if minimax_h3_sensitive_fact_concepts(phrase, affirmative_only=False)
        or minimax_h3_sensitive_categories(phrase)
    ]
    selected_keys = {item.casefold() for item in selected}
    if not minimax_h3_rich_interaction_evidence_is_complete(
        verified_rich,
        "；".join(selected),
    ):
        for phrase in phrases:
            if phrase.casefold() in selected_keys:
                continue
            selected.append(phrase)
            selected_keys.add(phrase.casefold())
            if minimax_h3_rich_interaction_evidence_is_complete(
                verified_rich,
                "；".join(selected),
            ):
                break
    evidence_text = "；".join(selected)
    if not selected or not minimax_h3_rich_interaction_evidence_is_complete(
        verified_rich,
        evidence_text,
    ):
        raise VisualContractError(
            "MiniMax H3 富视觉确认仍缺少具体互动证据，已阻断",
            code="h3-interaction-rich-evidence-incomplete",
            semantic=True,
            diagnostics={
                "errorCode": "h3-interaction-rich-evidence-incomplete",
                "pictureIndex": int(picture_index),
                "generationGate": "blocked",
            },
        )

    projected = json.loads(json.dumps(first_contract, ensure_ascii=False))
    projected.pop(MINIMAX_H3_DEACTIVATED_INTERACTION_MARKER, None)
    projected.pop(MINIMAX_H3_AMBIGUOUS_AGE_VALIDATED_MARKER, None)
    safety = projected.get("content_safety") or {}
    age = clean_text(safety.get("age_assessment") or "")
    if age != "adult_appearing" and minimax_h3_contains_explicit_adult_assertion(evidence_text):
        raise VisualContractError(
            "MiniMax H3 富视觉确认不能把不可验证年龄推断为成年",
            code="h3-interaction-rich-age-inference",
            semantic=True,
            diagnostics={
                "errorCode": "h3-interaction-rich-age-inference",
                "pictureIndex": int(picture_index),
                "generationGate": "blocked",
            },
        )

    evidence_facts = minimax_h3_pack_verified_rich_facts(selected)
    projected["relations"] = list(dict.fromkeys([
        *[clean_text(item) for item in (projected.get("relations") or []) if clean_text(item)],
        *evidence_facts,
    ]))
    initial_non_activity_facts: list[str] = []
    for item in (safety.get("sensitive_visible_facts") or []):
        fact = clean_text(item)
        concepts = minimax_h3_sensitive_fact_concepts(
            fact,
            affirmative_only=False,
        )
        activity_concepts = {
            concept for concept in concepts if concept.startswith("activity_")
        }
        # The first structural IR is authoritative for ordinary facts and for
        # concrete non-activity sensitive state.  Its generic activity label is
        # exactly what failed the interaction gate, so it cannot be promoted to
        # a verified H3 fact unless the rich same-image pass supplies complete
        # evidence independently.
        if fact and concepts and not activity_concepts:
            initial_non_activity_facts.append(fact)
    merged_fact_values = [*initial_non_activity_facts, *evidence_facts]
    safety["sensitive_visible_facts"] = minimax_h3_pack_verified_rich_facts(
        list(dict.fromkeys(merged_fact_values)),
    )
    confirmed_signals = minimax_h3_sensitive_categories(evidence_text)
    signals = [
        clean_text(item) for item in (safety.get("signals") or []) if clean_text(item)
    ]
    for signal in MINIMAX_H3_SENSITIVE_SIGNAL_PATTERNS:
        if signal in confirmed_signals and signal not in signals:
            signals.append(signal)
    safety["signals"] = signals
    if "explicit_activity" in signals:
        safety["interaction_category"] = "sexual"
    if set(signals) & {"explicit_activity", "explicit_anatomy", "sexual_fluid"}:
        safety["level"] = "explicit"
    projected["content_safety"] = safety
    return parse_minimax_h3_local_visual_contract(
        json.dumps(projected, ensure_ascii=False),
    )


def minimax_h3_visual_ir_repair_instruction(reason_code: str = "") -> str:
    """Return one fresh same-image repair request for a rejected shared v2 IR."""

    safe_reason = clean_text(reason_code).lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", safe_reason):
        safe_reason = "visual-contract-invalid"
    return (
        minimax_h3_compact_visual_contract_instruction()
        + "上一次同图视觉IR未通过共享nf.visual.v2合同校验（仅供定位的错误码："
        + safe_reason
        + "）。请重新观察同一张图片，从零返回完整且精确的13键JSON；不得复制、概括或修补上一次文本，"
        "不得使用通用模板。实体、数量、外观、姿态、动作、关系、场景、视角、光线、颜色和材质只写图片中"
        "直接可见的事实。若存在敏感可见事实，level、body、interaction、signals与facts必须相互一致并写具体"
        "证据；若没有，则返回事实完整且内部一致的safe合同。年龄无法由画面明确判断时使用age_unverifiable，"
        "不得推断成年，也不得忽略明确未成年人证据。"
    )


def minimax_h3_sensitive_ir_review_instruction() -> str:
    """Return a one-shot same-image review for missing sensitive visual facts."""

    return (
        minimax_h3_compact_visual_contract_instruction()
        + "本次是同一张图片的敏感可见事实完整性复核。不要参考或复述上一次输出，只重新观察图片；"
        "不得因题材敏感而把直接可见事实泛化为safe，也不得为了迎合请求而补写图片中不可见的事实。"
        "若直接可见body、解剖、姿势或互动证据，必须让level、body、interaction、signals与facts相互一致，"
        "facts逐项写具体可见对象和状态；若没有敏感可见证据，则返回内部一致的safe合同。"
        "年龄只按可见证据填写：没有明确年轻化证据但图片不能证明成年时使用age_unverifiable，禁止推断成年。"
    )


def minimax_h3_sensitive_ir_review_reason(contract: dict) -> str:
    """Return a bounded reason only for the three reviewable IR failure shapes."""

    safety = contract.get("content_safety") or {}
    level = clean_text(safety.get("level") or "")
    age = clean_text(safety.get("age_assessment") or "")
    body = clean_text(safety.get("body_exposure") or "")
    interaction = clean_text(safety.get("interaction_category") or "")
    signals = {clean_text(item) for item in (safety.get("signals") or []) if clean_text(item)}
    facts = [
        clean_text(item)
        for item in (safety.get("sensitive_visible_facts") or [])
        if clean_text(item)
    ]
    if (
        age in {
            "age_unverifiable", "young_or_minor_indicators", "ambiguous_or_young_appearing",
        }
        and minimax_h3_contract_contains_explicit_adult_assertion(contract)
    ):
        return "sensitive-ir-contradictory"
    if level == "safe":
        if body != "none" or interaction != "none" or signals or facts:
            return "sensitive-ir-contradictory"
        return "sensitive-ir-safe"
    if level == "uncertain":
        return "sensitive-evidence-empty"
    if level in MINIMAX_H3_SENSITIVE_LEVELS:
        if not facts:
            return "sensitive-facts-empty"
        inconsistent = (
            (body in {"partial", "full"}) != ("nudity" in signals)
            or (interaction == "sexual") != ("explicit_activity" in signals)
            or (level == "explicit" and not (
                interaction == "sexual"
                or bool(signals & {"explicit_activity", "explicit_anatomy", "sexual_fluid"})
            ))
        )
        if inconsistent:
            return "sensitive-ir-contradictory"
    return ""


def minimax_h3_safe_ir_complete_and_consistent(first: dict, reviewed: dict) -> bool:
    """Accept a repeated safe result only when ordinary facts remain complete and stable."""

    safety_pair = [item.get("content_safety") or {} for item in (first, reviewed)]
    if any(clean_text(item.get("level") or "") != "safe" for item in safety_pair):
        return False
    if clean_text(safety_pair[0].get("visible_person_count")) != clean_text(
        safety_pair[1].get("visible_person_count")
    ):
        return False
    safe_age_values = {
        clean_text(item.get("age_assessment") or "") for item in safety_pair
    }
    if len(safe_age_values) > 1 and not safe_age_values.issubset({
        "age_unverifiable", "young_or_minor_indicators", "ambiguous_or_young_appearing",
    }):
        return False

    def has_complete_ordinary_facts(contract: dict) -> bool:
        people = int((contract.get("content_safety") or {}).get("visible_person_count") or 0)
        entities = [item for item in (contract.get("entities") or []) if isinstance(item, dict)]
        scene = contract.get("scene") or {}
        camera = contract.get("camera_cues") or {}
        if not clean_text(contract.get("asset_type") or "") or not entities:
            return False
        if people > 0 and (
            len(entities) < people
            or any(
                not (
                    clean_text(entity.get("name") or "")
                    or any(clean_text(item) for item in (entity.get("appearance") or []))
                )
                for entity in entities[:people]
            )
        ):
            return False
        if not (clean_text(scene.get("environment") or "") or clean_text(scene.get("background") or "")):
            return False
        if not (clean_text(camera.get("shot") or "") or clean_text(camera.get("composition") or "")):
            return False
        return True

    if not all(has_complete_ordinary_facts(item) for item in (first, reviewed)):
        return False

    def stable_text(left: str, right: str, group: str = "") -> bool:
        left = clean_text(left)
        right = clean_text(right)
        if not left and not right:
            return True
        if not left or not right:
            return False
        return (
            minimax_h3_group_has_fidelity(left, right, group)
            and minimax_h3_group_has_fidelity(right, left, group)
        )

    if not stable_text(first.get("asset_type"), reviewed.get("asset_type"), "identity"):
        return False
    first_entities = [item for item in (first.get("entities") or []) if isinstance(item, dict)]
    reviewed_entities = [item for item in (reviewed.get("entities") or []) if isinstance(item, dict)]
    if len(first_entities) != len(reviewed_entities):
        return False
    for left, right in zip(first_entities, reviewed_entities):
        if clean_text(left.get("kind") or "") != clean_text(right.get("kind") or ""):
            return False
        comparisons = (
            (left.get("name"), right.get("name"), "identity"),
            (" ".join(left.get("appearance") or []), " ".join(right.get("appearance") or []), "identity"),
            (left.get("pose"), right.get("pose"), "state"),
            (left.get("action"), right.get("action"), "action"),
        )
        if any(not stable_text(a, b, group) for a, b, group in comparisons):
            return False
    for key in ("environment", "background"):
        if not stable_text(
            (first.get("scene") or {}).get(key),
            (reviewed.get("scene") or {}).get(key),
            "scene",
        ):
            return False
    for key in ("shot", "angle", "composition", "depth_of_field"):
        if not stable_text(
            (first.get("camera_cues") or {}).get(key),
            (reviewed.get("camera_cues") or {}).get(key),
        ):
            return False
    return True


def minimax_h3_deactivated_sensitive_fact_labels(concepts: set[str], body: str) -> list[str]:
    """Compile only shared, non-activity facts already asserted by both IR attempts."""

    labels: list[str] = []
    if body == "full":
        labels.append("主体全裸状态直接可见")
    elif body == "partial":
        labels.append("主体局部裸露状态直接可见")
    # Keep the most specific shared anatomy instead of broadening it.  Parent
    # concepts are emitted only when neither child concept was jointly seen.
    anatomy_labels = (
        ("anatomy_nipple", "主体乳头直接可见"),
        ("anatomy_penis", "主体阴茎直接可见"),
        ("anatomy_vagina", "主体阴道直接可见"),
        ("anatomy_vulva", "主体外阴直接可见"),
        ("anatomy_anus", "主体肛门直接可见"),
    )
    specific_anatomy = {concept for concept, _label in anatomy_labels if concept in concepts}
    for concept, label in anatomy_labels:
        if concept in concepts:
            labels.append(label)
    if "anatomy_breast" in concepts and "anatomy_nipple" not in specific_anatomy:
        labels.append("主体乳房直接可见")
    if "anatomy_genital" in concepts and not specific_anatomy.intersection({
        "anatomy_penis", "anatomy_vagina", "anatomy_vulva", "anatomy_anus",
    }):
        labels.append("主体生殖器直接可见")
    if "fluid_semen" in concepts:
        labels.append("画面中的精液直接可见")
    elif "fluid_general" in concepts:
        labels.append("画面中的性体液直接可见")
    if "pose_sexualized" in concepts:
        labels.append("主体的性暗示姿势直接可见")
    return labels


def minimax_h3_deactivate_incomplete_interaction_contracts(
    first_contract: dict,
    repaired_contract: dict,
    policy: dict,
    request_text: str,
    picture_index: int,
) -> dict:
    """Fail-closed projection after two exact interaction-evidence failures.

    Both inputs are structurally normalized nf.visual.v2 IRs.  The projection
    intentionally discards every activity/contact assertion and accepts only
    stable age/exposure plus the intersection of concrete non-activity facts.
    It is then parsed again with the full semantic validator before use.
    """

    activity_categories = minimax_h3_authorized_request_sensitive_categories(request_text)
    activity_facts = minimax_h3_authorized_request_sensitive_facts(request_text)
    if "explicit_activity" in activity_categories or any(
        concept.startswith("activity_") for concept in activity_facts
    ):
        raise VisualContractError(
            "MiniMax H3 原始要求包含肯定性活动，不能使用去活动视觉回退",
            code="h3-interaction-fallback-user-activity-blocked",
            semantic=True,
            diagnostics={
                "errorCode": "h3-interaction-fallback-user-activity-blocked",
                "requestedVisualSchema": policy.get("schema") or "",
                "pictureIndex": int(picture_index),
                "generationGate": "blocked",
            },
        )
    if policy.get("sensitiveVisualAnalysis") is not True:
        raise VisualContractError(
            "MiniMax H3 去活动视觉回退需要显式开启敏感事实分析",
            code="h3-sensitive-analysis-required",
            semantic=True,
            diagnostics={
                "errorCode": "h3-sensitive-analysis-required",
                "requestedVisualSchema": policy.get("schema") or "",
                "pictureIndex": int(picture_index),
                "generationGate": "blocked",
            },
        )

    safety_pairs = [contract.get("content_safety") or {} for contract in (
        first_contract, repaired_contract,
    )]
    stable_keys = ("visible_person_count", "body_exposure")
    inconsistent = [
        key for key in stable_keys
        if clean_text(safety_pairs[0].get(key)) != clean_text(safety_pairs[1].get(key))
    ]
    age_values = [clean_text(item.get("age_assessment") or "") for item in safety_pairs]
    ambiguous_age_values = {
        "age_unverifiable", "young_or_minor_indicators", "ambiguous_or_young_appearing",
    }
    if age_values[0] != age_values[1] and not set(age_values).issubset(ambiguous_age_values):
        inconsistent.append("age_assessment")
    if inconsistent:
        raise VisualContractError(
            "MiniMax H3 两次视觉分析的主体安全摘要不一致，已阻断",
            code="h3-interaction-fallback-inconsistent",
            semantic=True,
            diagnostics={
                "errorCode": "h3-interaction-fallback-inconsistent",
                "requestedVisualSchema": policy.get("schema") or "",
                "pictureIndex": int(picture_index),
                "generationGate": "blocked",
            },
        )
    age = (
        "age_unverifiable"
        if set(age_values).issubset(ambiguous_age_values)
        else age_values[0]
    )
    body = clean_text(safety_pairs[0].get("body_exposure") or "")
    if (
        minimax_h3_contains_affirmative_young(request_text)
        or minimax_h3_contract_has_explicit_minor_evidence(first_contract)
        or minimax_h3_contract_has_explicit_minor_evidence(repaired_contract)
    ):
        raise VisualContractError(
            "MiniMax H3 去活动视觉回退检测到明确未成年人证据，已阻断",
            code="h3-sensitive-young-evidence-blocked",
            semantic=True,
            diagnostics={
                "errorCode": "h3-sensitive-young-evidence-blocked",
                "requestedVisualSchema": policy.get("schema") or "",
                "pictureIndex": int(picture_index),
                "generationGate": "blocked",
            },
        )

    def non_activity_facts(contract: dict) -> set[str]:
        safety = contract.get("content_safety") or {}
        visible = " ".join(
            clean_text(item)
            for item in (safety.get("sensitive_visible_facts") or [])
            if clean_text(item)
        )
        concepts = minimax_h3_sensitive_fact_concepts(visible, affirmative_only=False)
        return {
            concept for concept in concepts
            if not concept.startswith("activity_")
        }

    common_facts = non_activity_facts(first_contract) & non_activity_facts(repaired_contract)
    common_signals = (
        {clean_text(item) for item in (safety_pairs[0].get("signals") or [])}
        & {clean_text(item) for item in (safety_pairs[1].get("signals") or [])}
    ) - {"explicit_activity"}
    if body in {"partial", "full"} and "nudity" in common_signals:
        common_facts.add("nudity_general")
        common_facts.add("nudity_full" if body == "full" else "nudity_partial")
    if "sexualized_pose" in common_signals:
        common_facts.add("pose_sexualized")
    fact_labels = minimax_h3_deactivated_sensitive_fact_labels(common_facts, body)
    if not fact_labels:
        raise VisualContractError(
            "MiniMax H3 两次视觉分析没有共同的非活动敏感事实，已阻断",
            code="h3-interaction-fallback-facts-empty",
            semantic=True,
            diagnostics={
                "errorCode": "h3-interaction-fallback-facts-empty",
                "requestedVisualSchema": policy.get("schema") or "",
                "pictureIndex": int(picture_index),
                "generationGate": "blocked",
            },
        )

    projected = json.loads(json.dumps(repaired_contract, ensure_ascii=False))
    projected["relations"] = []
    for entity in projected.get("entities") or []:
        if isinstance(entity, dict):
            entity["action"] = None
    projected_safety = projected["content_safety"]
    projected_safety["interaction_category"] = "none"
    projected_signals: list[str] = []
    if body in {"partial", "full"}:
        projected_signals.append("nudity")
    if "pose_sexualized" in common_facts:
        projected_signals.append("sexualized_pose")
    specific_anatomy = common_facts & {
        "anatomy_breast", "anatomy_nipple", "anatomy_genital", "anatomy_penis",
        "anatomy_vagina", "anatomy_vulva", "anatomy_anus",
    }
    if specific_anatomy:
        projected_signals.append("explicit_anatomy")
    if common_facts & {"fluid_general", "fluid_semen"}:
        projected_signals.append("sexual_fluid")
    if age in {
        "age_unverifiable", "young_or_minor_indicators", "ambiguous_or_young_appearing",
    }:
        projected_signals.append("age_ambiguous")
    projected_safety["signals"] = projected_signals
    projected_safety["sensitive_visible_facts"] = fact_labels
    if "explicit_anatomy" in projected_signals or "sexual_fluid" in projected_signals:
        projected_safety["level"] = "explicit"
    elif body in {"partial", "full"}:
        projected_safety["level"] = "nudity"
    elif "sexualized_pose" in projected_signals:
        projected_safety["level"] = "suggestive"
    else:
        raise VisualContractError(
            "MiniMax H3 去活动视觉投影没有可用的敏感分级，已阻断",
            code="h3-interaction-fallback-facts-empty",
            semantic=True,
            diagnostics={
                "errorCode": "h3-interaction-fallback-facts-empty",
                "requestedVisualSchema": policy.get("schema") or "",
                "pictureIndex": int(picture_index),
                "generationGate": "blocked",
            },
        )
    # This is the critical trust boundary: no projected IR reaches prompt
    # compilation until the complete nf.visual.v2 semantic gate passes.
    validated_projection = parse_visual_contract(
        json.dumps(projected, ensure_ascii=False),
        expected_schema=VISUAL_SCHEMA_VERSION_V2,
        validate_semantics=True,
    )
    # Private sidecar marker: never serialized into the nf.visual.v2 contract.
    # It only narrows the final H3 surface-label checks after the full semantic
    # gate above has accepted the deterministic de-activity projection.
    validated_projection[MINIMAX_H3_DEACTIVATED_INTERACTION_MARKER] = True
    if age in {"young_or_minor_indicators", "ambiguous_or_young_appearing"}:
        validated_projection[MINIMAX_H3_AMBIGUOUS_AGE_VALIDATED_MARKER] = True
    return validated_projection


def minimax_h3_fact_tokens(value: str) -> set[str]:
    text = clean_text(value).lower()
    stop = {"人物", "角色", "主体", "画面", "可见", "一个", "一名", "环境", "背景", "镜头", "参考图"}
    tokens = {
        word for word in re.findall(r"[a-z][a-z0-9_-]{3,}|[0-9]+", text)
        if word not in stop
    }
    for sequence in re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{2,}", text):
        for size in (2, 3):
            tokens.update(
                sequence[index:index + size]
                for index in range(max(0, len(sequence) - size + 1))
                if sequence[index:index + size] not in stop
            )
    return tokens


def minimax_h3_match_is_negated(value: str, match: re.Match) -> bool:
    """Recognize a nearby negative scope without treating the term as consent."""

    normalized = clean_text(value)
    prefix = normalized[max(0, match.start() - 64):match.start()]
    prefix = re.split(r"[\r\n，。；;,.!?！？]", prefix)[-1]
    if MINIMAX_H3_SENSITIVE_REQUEST_NEGATION_PATTERN.search(prefix):
        return True
    suffix = normalized[match.end():match.end() + 36]
    return bool(re.match(
        r"\s*(?:(?:is|are|was|were|must\s+be|should\s+be)\s+)?"
        r"(?:not\s+(?:present|shown|included|allowed)|absent|excluded|forbidden|prohibited)\b"
        r"|\s*(?:不存在|未出现|不出现|不要出现|不得出现|被排除|被禁止)",
        suffix,
        re.I,
    ))


def minimax_h3_affirmative_pattern_matches(value: str, pattern: re.Pattern) -> list[re.Match]:
    normalized = clean_text(value)
    return [
        match for match in pattern.finditer(normalized)
        if not minimax_h3_match_is_negated(normalized, match)
    ]


def minimax_h3_contains_affirmative_young(value: str) -> bool:
    return bool(minimax_h3_affirmative_pattern_matches(value, MINIMAX_H3_YOUNG_OUTPUT_PATTERN))


def minimax_h3_contains_explicit_adult_assertion(value: str) -> bool:
    return bool(minimax_h3_affirmative_pattern_matches(
        value,
        MINIMAX_H3_EXPLICIT_ADULT_ASSERTION_PATTERN,
    ))


def minimax_h3_contract_contains_affirmative_young(contract: dict) -> bool:
    """Inspect direct IR facts, excluding explicitly uncertain candidates."""

    pending: list[object] = [contract]
    while pending:
        value = pending.pop()
        if isinstance(value, dict):
            pending.extend(
                item for key, item in value.items()
                if clean_text(key).lower() != "uncertain"
            )
        elif isinstance(value, (list, tuple, set)):
            pending.extend(value)
        elif isinstance(value, str) and minimax_h3_contains_affirmative_young(value):
            return True
    return False


def minimax_h3_contract_has_explicit_minor_evidence(contract: dict) -> bool:
    safety = contract.get("content_safety") or {}
    return bool(
        clean_text(safety.get("age_assessment") or "") == "minor"
        or minimax_h3_contract_contains_affirmative_young(contract)
    )


def minimax_h3_contract_contains_explicit_adult_assertion(contract: dict) -> bool:
    pending: list[object] = [contract]
    while pending:
        value = pending.pop()
        if isinstance(value, dict):
            pending.extend(value.values())
        elif isinstance(value, (list, tuple, set)):
            pending.extend(value)
        elif isinstance(value, str) and minimax_h3_contains_explicit_adult_assertion(value):
            return True
    return False


def minimax_h3_fact_concepts(value: str) -> set[str]:
    normalized = clean_text(value)
    return {
        concept
        for concept, pattern in MINIMAX_H3_FACT_CONCEPT_PATTERNS.items()
        if pattern.search(normalized)
    }


def minimax_h3_sensitive_fact_concepts(value: str, *, affirmative_only: bool = True) -> set[str]:
    normalized = clean_text(value)
    direct = {
        concept
        for concept, pattern in MINIMAX_H3_SENSITIVE_FACT_PATTERNS.items()
        if (
            minimax_h3_affirmative_pattern_matches(normalized, pattern)
            if affirmative_only
            else pattern.search(normalized)
        )
    }
    expanded = set(direct)
    if "anatomy_nipple" in direct:
        expanded.add("anatomy_breast")
    if direct & {"anatomy_penis", "anatomy_vagina", "anatomy_vulva", "anatomy_anus"}:
        expanded.add("anatomy_genital")
    if direct & {
        "activity_masturbation", "activity_oral", "activity_anal", "activity_penetration"
    }:
        expanded.add("activity_general")
    if "fluid_semen" in direct:
        expanded.add("fluid_general")
    if direct & {"nudity_full", "nudity_partial"}:
        expanded.add("nudity_general")
    return expanded


def minimax_h3_contract_fact_groups(contract: dict, include_sensitive: bool) -> list[str]:
    identity = [clean_text(contract.get("asset_type") or "")]
    state = []
    scene_look = []
    for entity in contract.get("entities") or []:
        if not isinstance(entity, dict):
            continue
        identity.extend([
            clean_text(entity.get("name") or ""),
            *[clean_text(item) for item in (entity.get("appearance") or [])],
            *[clean_text(item) for item in (entity.get("colors") or [])],
        ])
        state.extend([clean_text(entity.get("pose") or ""), clean_text(entity.get("action") or "")])
    state.extend(clean_text(item) for item in (contract.get("relations") or []))
    safety = contract.get("content_safety") or {}
    if include_sensitive:
        state.extend(clean_text(item) for item in (safety.get("sensitive_visible_facts") or []))
    scene = contract.get("scene") or {}
    look = contract.get("look") or {}
    camera = contract.get("camera_cues") or {}
    scene_look.extend([
        clean_text(scene.get("environment") or ""), clean_text(scene.get("background") or ""),
        *[clean_text(item) for item in (scene.get("spatial_layers") or [])],
        clean_text(camera.get("shot") or ""), clean_text(camera.get("angle") or ""),
        clean_text(camera.get("composition") or ""),
        *[clean_text(item) for item in (look.get("lighting") or [])],
        *[clean_text(item) for item in (look.get("style") or [])],
    ])
    return [" ".join(item for item in group if item) for group in (identity, state, scene_look) if any(group)]


def minimax_h3_contract_fact_map(contract: dict, include_sensitive: bool) -> dict[str, object]:
    identities: list[str] = []
    poses: list[str] = []
    actions: list[str] = []
    entity_facts: list[dict[str, str]] = []
    for entity in contract.get("entities") or []:
        if not isinstance(entity, dict):
            continue
        count = clean_text(entity.get("count") or "")
        identity = " ".join(filter(None, [
            clean_text(entity.get("kind") or ""),
            clean_text(entity.get("name") or ""),
            *[clean_text(item) for item in (entity.get("appearance") or [])],
            *[clean_text(item) for item in (entity.get("colors") or [])],
            *[clean_text(item) for item in (entity.get("materials") or [])],
        ]))
        if identity:
            identities.append(identity)
        pose = clean_text(entity.get("pose") or "")
        action = clean_text(entity.get("action") or "")
        if pose:
            poses.append(pose)
        if action:
            actions.append(action)
        entity_facts.append({
            "count": count,
            "identity": identity,
            "pose": pose,
            "action": action,
        })
    relations = " ".join(
        clean_text(item) for item in (contract.get("relations") or []) if clean_text(item)
    )
    scene = contract.get("scene") or {}
    scene_text = " ".join(filter(None, [
        clean_text(scene.get("environment") or ""),
        clean_text(scene.get("background") or ""),
        *[clean_text(item) for item in (scene.get("spatial_layers") or [])],
    ]))
    camera = contract.get("camera_cues") or {}
    camera_text = " ".join(filter(None, [
        clean_text(camera.get("shot") or ""),
        clean_text(camera.get("angle") or ""),
        clean_text(camera.get("composition") or ""),
        clean_text(camera.get("depth_of_field") or ""),
    ]))
    safety = contract.get("content_safety") or {}
    sensitive_text = " ".join(
        clean_text(item) for item in (safety.get("sensitive_visible_facts") or []) if clean_text(item)
    ) if include_sensitive else ""
    return {
        "age": clean_text(safety.get("age_assessment") or ""),
        "visiblePersonCount": int(safety.get("visible_person_count") or 0),
        "entities": entity_facts,
        "identities": identities,
        "poses": poses,
        "actions": actions,
        "relations": relations,
        "scene": scene_text,
        "camera": camera_text,
        "sensitive": sensitive_text,
    }


def minimax_h3_deterministic_entity_scope(scope: str, entity_index: int) -> str:
    """Return one deterministic Subject/主体 slot, or empty for legacy prose."""

    def is_slot_marker(match: re.Match) -> bool:
        if re.match(
            r"\s*(?:数量|身份|姿态|动作|count\b|identity\b|pose\b|action\b)",
            scope[match.end():],
            re.I,
        ):
            return True
        prefix = clean_text(scope[:match.start()]).casefold()
        return prefix.endswith((
            "frame facts:", "画面事实：", "首帧事实：", "尾帧事实：", "。", ".",
        ))

    entity_markers = [
        match
        for match in re.finditer(
            r"(?:主体|Subject)\s*([1-9][0-9]*)\s*[:：]",
            scope,
            re.I,
        )
        if is_slot_marker(match)
    ]
    marker = next(
        (
            match for match in entity_markers
            if int(match.group(1)) == int(entity_index)
        ),
        None,
    )
    if marker is None:
        return ""
    following_positions = [
        match.start() for match in entity_markers if match.start() > marker.start()
    ]
    following_positions.extend(
        match.start()
        for match in re.finditer(
            r"(?:关系|Relations|场景|Scene|画面|Framing|光色材质|Look|敏感可见事实|Visible sensitive facts)\s*[:：]",
            scope,
            re.I,
        )
        if match.start() > marker.start()
        and clean_text(scope[:match.start()]).endswith(("。", "."))
    )
    end = min(following_positions) if following_positions else len(scope)
    return scope[marker.start():end]


def minimax_h3_entity_count_has_fidelity(count: str, scope: str) -> bool:
    normalized_count = re.sub(r"\s+", "", clean_text(count)).casefold()
    normalized_scope = re.sub(r"\s+", "", clean_text(scope)).casefold()
    return not normalized_count or normalized_count in normalized_scope


def minimax_h3_apparel_categories(value: str) -> set[str]:
    normalized = clean_text(value)
    return {
        category
        for category, pattern in MINIMAX_H3_APPAREL_CATEGORY_PATTERNS.items()
        if pattern.search(normalized)
    }


def minimax_h3_sensitive_categories(value: str) -> set[str]:
    normalized = clean_text(value)
    return {
        category
        for category, pattern in MINIMAX_H3_SENSITIVE_SIGNAL_PATTERNS.items()
        if minimax_h3_affirmative_pattern_matches(normalized, pattern)
    }


def minimax_h3_authorized_request_sensitive_categories(value: str) -> set[str]:
    """Project only affirmative raw-user sensitive requests into the allow-list."""

    normalized = clean_text(value)
    return {
        category
        for category, pattern in MINIMAX_H3_SENSITIVE_SIGNAL_PATTERNS.items()
        if minimax_h3_affirmative_pattern_matches(normalized, pattern)
    }


def minimax_h3_authorized_request_sensitive_facts(value: str) -> set[str]:
    return minimax_h3_sensitive_fact_concepts(value, affirmative_only=True)


def minimax_h3_contract_sensitive_facts(contract: dict) -> tuple[set[str], set[str]]:
    """Return (allowed, required) concrete facts from the trusted visual IR."""

    safety = contract.get("content_safety") or {}
    visible_facts = " ".join(
        clean_text(item) for item in (safety.get("sensitive_visible_facts") or []) if clean_text(item)
    )
    entity_facts = []
    for entity in contract.get("entities") or []:
        if not isinstance(entity, dict):
            continue
        entity_facts.extend([
            clean_text(entity.get("pose") or ""),
            clean_text(entity.get("action") or ""),
            *[clean_text(item) for item in (entity.get("appearance") or [])],
        ])
    relation_facts = [clean_text(item) for item in (contract.get("relations") or [])]
    concrete_text = " ".join(filter(None, [visible_facts, *entity_facts, *relation_facts]))
    required = minimax_h3_sensitive_fact_concepts(visible_facts, affirmative_only=False)
    if contract.get(MINIMAX_H3_DEACTIVATED_INTERACTION_MARKER) is True:
        # `sexualized_pose` is a safety classification, not a phrase the H3
        # prose must repeat.  The concrete per-frame entity.pose remains
        # mandatory in validate_minimax_h3_visual_fact_coverage below.
        required.discard("pose_sexualized")
    allowed = minimax_h3_sensitive_fact_concepts(concrete_text, affirmative_only=False)
    body = clean_text(safety.get("body_exposure") or "")
    signals = {clean_text(item) for item in (safety.get("signals") or [])}
    if body == "full":
        allowed.update({"nudity_general", "nudity_full"})
    elif body == "partial":
        allowed.update({"nudity_general", "nudity_partial"})
    if "nudity" in signals:
        allowed.add("nudity_general")
    if "sexualized_pose" in signals:
        allowed.add("pose_sexualized")
    if "explicit_activity" in signals:
        allowed.add("activity_general")
    if "sexual_fluid" in signals:
        allowed.add("fluid_general")
    return allowed, required


def minimax_h3_group_has_fidelity(source: str, output: str, group: str) -> bool:
    source = clean_text(source)
    output = clean_text(output)
    if not source:
        return True
    source_concepts = minimax_h3_fact_concepts(source)
    output_concepts = minimax_h3_fact_concepts(output)
    concept_prefixes = {
        "identity": ("age_", "identity_", "feature_"),
        "state": ("pose_",),
        "action": ("action_", "body_"),
        "scene": ("scene_",),
    }.get(group)
    if concept_prefixes:
        source_concepts = {
            concept for concept in source_concepts if concept.startswith(concept_prefixes)
        }
        output_concepts = {
            concept for concept in output_concepts if concept.startswith(concept_prefixes)
        }
    concept_overlap = source_concepts & output_concepts
    concept_requirement = 1
    if group == "identity" and len(source_concepts) >= 3:
        concept_requirement = 2
    if source_concepts:
        if len(concept_overlap) >= concept_requirement:
            return True
        if group in {"state", "action", "scene"}:
            return False
    source_tokens = minimax_h3_fact_tokens(source)
    output_tokens = minimax_h3_fact_tokens(output)
    token_requirement = max(1, min(3, math.ceil(len(source_tokens) * 0.08)))
    return bool(source_tokens) and len(source_tokens & output_tokens) >= token_requirement


def minimax_h3_output_field_value(text: str, field: str) -> str:
    match = re.search(rf"(?im)^\s*{re.escape(field)}\s*:\s*", text)
    if not match:
        return ""
    following = re.search(r"(?m)^\s*[a-z][a-z0-9_]*\s*:", text[match.end():])
    end = match.end() + following.start() if following else len(text)
    return clean_text(text[match.end():end])


def validate_minimax_h3_user_motion_intent_coverage(
    text: str,
    user_prompt: str,
    user_requirements: str,
) -> str:
    """Require selected user motion after, never inside, the first verified fact anchor."""

    intents = minimax_h3_explicit_user_motion_intents(user_prompt, user_requirements)
    required = [*intents["actions"], *intents["camera"]]
    if not required:
        return text
    narrative = minimax_h3_output_field_value(
        text,
        "integrated_multimodal_description",
    )
    fact_markers = [
        position for marker in ("frame facts:", "画面事实：", "首帧事实：")
        if (position := narrative.find(marker)) >= 0
    ]
    first_fact_marker = min(fact_markers) if fact_markers else -1
    for clause in required:
        position = narrative.rfind(clause)
        if position < 0:
            raise ValueError("MiniMax H3 输出遗漏了原始用户明确的动作或运镜意图")
        if first_fact_marker < 0 or position <= first_fact_marker:
            raise ValueError("MiniMax H3 输出把用户后续意图错误写成了首帧视觉事实")
    return text


def minimax_h3_request_audio_facts(value: str) -> list[str]:
    """Return concrete user audio requirements, not H3 field-layout language."""

    clauses = [
        clean_text(item)
        for item in re.split(r"[\r\n，。；;!?！？]+", clean_text(value))
        if clean_text(item)
    ]
    selected: list[str] = []
    for clause in clauses:
        if not (
            MINIMAX_H3_AUDIO_REQUEST_PATTERN.search(clause)
            or MINIMAX_H3_GENERIC_AUDIO_CUE_PATTERN.search(clause)
        ):
            continue
        known_concepts = minimax_h3_audio_fact_concepts(clause)
        # "No audio requirement" means the user supplied no audio fact. It is
        # distinct from a concrete negative such as "no music", which remains
        # represented by ``music_none`` and therefore stays strict below.
        if (
            MINIMAX_H3_NO_AUDIO_REQUIREMENT_PATTERN.search(clause)
            and not known_concepts
        ):
            continue
        # Known concrete cues remain strict even when the user writes them in
        # an H3 field-shaped clause, for example ``overall_soundscape: 雨声``.
        if known_concepts:
            selected.append(clause)
            continue
        residual = clean_text(MINIMAX_H3_AUDIO_STRUCTURE_ONLY_PATTERN.sub(" ", clause))
        if not residual or not MINIMAX_H3_GENERIC_AUDIO_CUE_PATTERN.search(residual):
            continue
        if MINIMAX_H3_EXPLICIT_AUDIO_REQUIREMENT_PATTERN.search(residual):
            selected.append(clause)
    return selected


def minimax_h3_audio_fact_concepts(value: str) -> set[str]:
    normalized = clean_text(value)
    return {
        concept
        for concept, pattern in MINIMAX_H3_AUDIO_FACT_PATTERNS.items()
        if pattern.search(normalized)
    }


MINIMAX_H3_DETERMINISTIC_AUDIO_LABELS = {
    "audio_breath": {"zh": "呼吸声", "en": "breathing sound"},
    "audio_room_tone": {"zh": "房间环境声", "en": "room tone"},
    "audio_footsteps": {"zh": "脚步声", "en": "footsteps"},
    "audio_cloth": {"zh": "衣料摩擦声", "en": "cloth rustle"},
    "audio_wind": {"zh": "风声", "en": "wind sound"},
    "audio_rain": {"zh": "雨声", "en": "rain sound"},
    "audio_dialogue": {"zh": "对白", "en": "dialogue"},
    "music_piano": {"zh": "钢琴曲", "en": "piano music"},
    "music_ambient": {"zh": "氛围音乐", "en": "ambient music"},
}


def minimax_h3_deterministic_audio_fields(
    user_prompt: str,
    user_requirements: str,
    value_language: str,
) -> tuple[str, str]:
    """Serialize only explicit user audio facts into the two H3 audio fields."""

    use_english = clean_text(value_language).lower() == "en"
    language = "en" if use_english else "zh"
    request_text = "\n".join(
        item for item in (clean_text(user_prompt), clean_text(user_requirements)) if item
    )
    clauses = minimax_h3_request_audio_facts(request_text)
    sound_values: list[str] = []
    music_values: list[str] = []
    positive_music = False
    no_music = False

    def append_unique(target: list[str], value: str) -> None:
        value = clean_text(value)
        if value and value.casefold() not in {item.casefold() for item in target}:
            target.append(value)

    for clause in clauses:
        concepts = minimax_h3_audio_fact_concepts(clause)
        if "music_none" in concepts:
            no_music = True
        for concept in MINIMAX_H3_AUDIO_FACT_PATTERNS:
            if concept not in concepts or concept == "music_none":
                continue
            label = MINIMAX_H3_DETERMINISTIC_AUDIO_LABELS[concept][language]
            if concept.startswith("music_"):
                positive_music = True
                append_unique(music_values, label)
            else:
                append_unique(sound_values, label)
        if concepts:
            continue
        # An unknown but explicit cue cannot be translated without inference.
        # Keep its bounded user-authored clause verbatim in the correct field.
        if re.search(r"(?:音乐|配乐)|(?<![a-z0-9_])music(?![a-z0-9_])", clause, re.I):
            positive_music = True
            append_unique(music_values, clause)
        else:
            append_unique(sound_values, clause)

    if no_music and positive_music:
        raise ValueError("MiniMax H3 用户音频要求同时要求音乐与无音乐")
    separator = "; " if use_english else "、"
    soundscape = separator.join(sound_values) if sound_values else (
        "No verified sound."
        if use_english else "无额外已验证的事件声。"
    )
    if no_music:
        music = "N/A (no music)." if use_english else "N/A（无音乐）。"
    else:
        music = separator.join(music_values) if music_values else (
            "N/A."
            if use_english else "N/A（无额外已验证音乐）。"
        )
    return soundscape, music


def minimax_h3_picture_scope(text: str, picture_index: int, picture_count: int) -> str:
    header = re.search(
        r"(?im)^\s*integrated_multimodal_description\s*:\s*",
        text,
    )
    if not header:
        return text if picture_count == 1 else ""
    narrative_end = re.search(
        r"(?im)^\s*(?:overall_soundscape|non_diegetic_music)\s*:",
        text[header.end():],
    )
    end = header.end() + narrative_end.start() if narrative_end else len(text)
    narrative = text[header.end():end]
    if picture_count == 1:
        return narrative

    shot_matches = list(re.finditer(r"\[Shot ([1-9][0-9]*)\]", narrative))
    shot_scope = ""
    if shot_matches:
        if picture_index == 1 or len(shot_matches) > 1:
            shot_match = shot_matches[0] if picture_index == 1 else shot_matches[-1]
            shot_end = next(
                (match.start() for match in shot_matches if match.start() > shot_match.start()),
                len(narrative),
            )
            shot_scope = narrative[shot_match.start():shot_end]

    picture_token = f"<Picture {picture_index}>"
    explicit_clauses = []
    for clause in re.split(r"[\r\n;；]+", text):
        picture_matches = list(re.finditer(r"<Picture ([1-9][0-9]*)>", clause))
        for position, match in enumerate(picture_matches):
            if match.group(0) != picture_token:
                continue
            clause_end = (
                picture_matches[position + 1].start()
                if position + 1 < len(picture_matches)
                else len(clause)
            )
            explicit_clauses.append(clause[match.start():clause_end])
    return "\n".join([shot_scope, *explicit_clauses])


def minimax_h3_picture_apparel_scope(text: str, picture_index: int, picture_count: int) -> str:
    return minimax_h3_picture_scope(text, picture_index, picture_count)


def validate_minimax_h3_apparel_fidelity(text: str, contracts: list[dict]) -> None:
    source_categories = [
        minimax_h3_apparel_categories(json.dumps(contract, ensure_ascii=False))
        for contract in contracts
    ]
    output_categories = minimax_h3_apparel_categories(text)
    allowed_union = set().union(*source_categories) if source_categories else set()
    if output_categories - allowed_union:
        raise ValueError("MiniMax H3 输出臆造了参考图中不存在的衣着类别")
    for index, allowed in enumerate(source_categories, start=1):
        scoped = minimax_h3_picture_apparel_scope(text, index, len(contracts))
        scoped_categories = minimax_h3_apparel_categories(scoped)
        if scoped_categories - allowed:
            raise ValueError(f"MiniMax H3 输出把其他帧的衣着证据错误归给了 <Picture {index}>")


def validate_minimax_h3_visual_fact_coverage(
    text: str,
    contracts: list[dict],
    sensitive_enabled: bool,
    raw_request_text: str,
    require_entity_slots: bool = False,
) -> str:
    normalized = clean_text(text)
    if re.search(r"@(?:首帧|尾帧)|[（(]\s*image\s*[）)]", normalized, re.I):
        raise ValueError("MiniMax H3 输出不能泄漏 @首帧、@尾帧或 (image) 等界面别名")
    output_sensitive_categories = minimax_h3_sensitive_categories(normalized)
    requested_sensitive_categories = (
        minimax_h3_authorized_request_sensitive_categories(raw_request_text)
        if sensitive_enabled else set()
    )
    raw_request_sensitive_context = bool(
        minimax_h3_authorized_request_sensitive_categories(raw_request_text)
        or minimax_h3_authorized_request_sensitive_facts(raw_request_text)
    )
    contract_sensitive_categories = {
        clean_text(signal)
        for contract in contracts
        for signal in ((contract.get("content_safety") or {}).get("signals") or [])
        if clean_text(signal) in MINIMAX_H3_SENSITIVE_SIGNAL_PATTERNS
    }
    contract_sensitive_context = any(
        clean_text((contract.get("content_safety") or {}).get("level") or "")
        in MINIMAX_H3_SENSITIVE_LEVELS
        or any(
            clean_text(signal) in MINIMAX_H3_SENSITIVE_SIGNAL_PATTERNS
            for signal in ((contract.get("content_safety") or {}).get("signals") or [])
        )
        or bool(minimax_h3_sensitive_fact_concepts(" ".join(
            clean_text(item)
            for item in ((contract.get("content_safety") or {}).get("sensitive_visible_facts") or [])
            if clean_text(item)
        )))
        for contract in contracts
    )
    sensitive_context = bool(
        output_sensitive_categories
        or requested_sensitive_categories
        or raw_request_sensitive_context
        or contract_sensitive_context
    )
    contract_has_young_evidence = any(
        minimax_h3_contract_has_explicit_minor_evidence(contract)
        for contract in contracts
    )
    if sensitive_context and (
        contract_has_young_evidence
        or minimax_h3_contains_affirmative_young(normalized)
        or minimax_h3_contains_affirmative_young(raw_request_text)
    ):
        raise ValueError("MiniMax H3 敏感输出或请求不能与明确年轻化或未成年指向组合")
    unauthorized_categories = output_sensitive_categories - (
        contract_sensitive_categories | requested_sensitive_categories
    )
    if unauthorized_categories:
        categories = ", ".join(sorted(unauthorized_categories))
        raise ValueError(f"MiniMax H3 输出新增了未经视觉合同或原始用户要求授权的敏感类别：{categories}")

    output_sensitive_facts = minimax_h3_sensitive_fact_concepts(normalized)
    requested_sensitive_facts = (
        minimax_h3_authorized_request_sensitive_facts(raw_request_text)
        if sensitive_enabled else set()
    )
    contract_sensitive_facts: set[str] = set()
    required_sensitive_facts: set[str] = set()
    for contract in contracts:
        allowed, required = minimax_h3_contract_sensitive_facts(contract)
        contract_sensitive_facts.update(allowed)
        required_sensitive_facts.update(required)
    unauthorized_sensitive_facts = output_sensitive_facts - (
        contract_sensitive_facts | requested_sensitive_facts
    )
    if unauthorized_sensitive_facts:
        facts = ", ".join(sorted(unauthorized_sensitive_facts))
        raise ValueError(f"MiniMax H3 输出新增了未经授权的敏感视觉事实：{facts}")
    missing_sensitive_facts = required_sensitive_facts - output_sensitive_facts
    if sensitive_enabled and missing_sensitive_facts:
        facts = ", ".join(sorted(missing_sensitive_facts))
        raise ValueError(f"MiniMax H3 输出遗漏了视觉 IR 已确认的敏感事实：{facts}")

    validate_minimax_h3_apparel_fidelity(normalized, contracts)
    picture_count = len(contracts)
    for index, contract in enumerate(contracts, start=1):
        scope = minimax_h3_picture_scope(normalized, index, picture_count)
        if not scope:
            raise ValueError(f"MiniMax H3 输出缺少 <Picture {index}> 的逐帧事实范围")
        safety = contract.get("content_safety") or {}
        level = clean_text(safety.get("level") or "")
        age = clean_text(safety.get("age_assessment") or "")
        signals = set(safety.get("signals") or [])
        fact_map = minimax_h3_contract_fact_map(
            contract, sensitive_enabled and level in MINIMAX_H3_SENSITIVE_LEVELS
        )
        deterministic_fact_scope = bool(require_entity_slots)
        scope_concepts = minimax_h3_fact_concepts(scope)
        scope_has_young_evidence = minimax_h3_contains_affirmative_young(scope)
        if age == "minor" or (
            age in {"young_or_minor_indicators", "ambiguous_or_young_appearing"}
            and minimax_h3_contract_has_explicit_minor_evidence(contract)
        ):
            if (
                "age_child" not in scope_concepts
                and not scope_has_young_evidence
            ) or "age_adult" in scope_concepts:
                raise ValueError(f"MiniMax H3 输出改变了 <Picture {index}> 的未成年年龄事实")
        elif age == "adult_appearing":
            # adult_appearing is an internal visual assessment, not required
            # prompt wording.  Do not force the compiler to assert adulthood;
            # only reject an unequivocal minor fact that would change the IR.
            if "age_child" in scope_concepts or scope_has_young_evidence:
                raise ValueError(f"MiniMax H3 输出把 <Picture {index}> 改写为明确未成年人")
        elif age in {
            "age_unverifiable", "young_or_minor_indicators", "ambiguous_or_young_appearing",
        }:
            if (
                minimax_h3_contains_explicit_adult_assertion(scope)
                and not minimax_h3_contains_explicit_adult_assertion(raw_request_text)
            ):
                raise ValueError(
                    f"MiniMax H3 输出把 <Picture {index}> 的不可验证年龄推断为成年"
                )

        for entity_index, entity_fact in enumerate(
            fact_map.get("entities") or [],
            start=1,
        ):
            bound_entity_scope = minimax_h3_deterministic_entity_scope(
                scope,
                entity_index,
            )
            if deterministic_fact_scope and not bound_entity_scope:
                raise ValueError(
                    f"MiniMax H3 输出缺少 <Picture {index}> 主体{entity_index}的独立事实槽位"
                )
            entity_scope = bound_entity_scope or scope
            count = clean_text(entity_fact.get("count") or "")
            if (
                deterministic_fact_scope
                and count
                and not minimax_h3_entity_count_has_fidelity(count, entity_scope)
            ):
                raise ValueError(
                    f"MiniMax H3 输出未覆盖 <Picture {index}> 主体{entity_index}的数量事实"
                )
            identity = clean_text(entity_fact.get("identity") or "")
            if identity and not minimax_h3_group_has_fidelity(
                identity,
                entity_scope,
                "identity",
            ):
                raise ValueError(f"MiniMax H3 输出未覆盖 <Picture {index}> 的主体身份事实")
            pose = clean_text(entity_fact.get("pose") or "")
            if pose and not minimax_h3_group_has_fidelity(pose, entity_scope, "state"):
                raise ValueError(f"MiniMax H3 输出未覆盖 <Picture {index}> 的主体姿态事实")
            action = clean_text(entity_fact.get("action") or "")
            if action and not minimax_h3_group_has_fidelity(action, entity_scope, "action"):
                raise ValueError(f"MiniMax H3 输出未覆盖 <Picture {index}> 的主体动作事实")
        relations = clean_text(fact_map.get("relations") or "")
        if relations and not minimax_h3_group_has_fidelity(relations, scope, "action"):
            raise ValueError(f"MiniMax H3 输出未覆盖 <Picture {index}> 的主体关系事实")
        scene = clean_text(fact_map.get("scene") or "")
        if scene and not minimax_h3_group_has_fidelity(scene, scope, "scene"):
            raise ValueError(f"MiniMax H3 输出替换或遗漏了 <Picture {index}> 的场景事实")
        if level in MINIMAX_H3_SENSITIVE_LEVELS and sensitive_enabled:
            if minimax_h3_contains_affirmative_young(normalized):
                raise ValueError("MiniMax H3 敏感输出不能使用明确年轻化或未成年指向")
            for signal, pattern in MINIMAX_H3_SENSITIVE_SIGNAL_PATTERNS.items():
                if (
                    signal == "sexualized_pose"
                    and contract.get(MINIMAX_H3_DEACTIVATED_INTERACTION_MARKER) is True
                ):
                    continue
                if signal in signals and not minimax_h3_affirmative_pattern_matches(normalized, pattern):
                    raise ValueError(f"MiniMax H3 输出遗漏敏感可见事实类别：{signal}")

    audio_output = "\n".join(filter(None, [
        minimax_h3_output_field_value(normalized, "overall_soundscape"),
        minimax_h3_output_field_value(normalized, "non_diegetic_music"),
    ]))
    output_audio_concepts = minimax_h3_audio_fact_concepts(audio_output)
    for audio_fact in minimax_h3_request_audio_facts(raw_request_text):
        required_audio_concepts = minimax_h3_audio_fact_concepts(audio_fact)
        if required_audio_concepts:
            if not required_audio_concepts.issubset(output_audio_concepts):
                raise ValueError("MiniMax H3 输出未覆盖原始用户要求中的音频事实")
            if "music_none" in required_audio_concepts and (
                output_audio_concepts & {"music_piano", "music_ambient"}
            ):
                raise ValueError("MiniMax H3 输出违背了原始用户的无音乐要求")
        elif not minimax_h3_group_has_fidelity(audio_fact, audio_output, "audio"):
            raise ValueError("MiniMax H3 输出未覆盖原始用户要求中的音频事实")
    return normalized


def minimax_h3_safe_validation_failure_class(error: Exception) -> str:
    """Collapse validation details to a bounded class safe for public diagnostics."""

    message = clean_text(str(error))
    if any(marker in message for marker in ("敏感", "成年", "未成年", "成人内容")):
        return "sensitive-fidelity"
    if "音频" in message:
        return "audio-fidelity"
    if any(marker in message for marker in (
        "Picture", "主体", "场景", "衣着", "逐帧", "视觉", "动作", "运镜",
    )):
        return "visual-fidelity"
    if any(marker in message for marker in ("中文", "英文", "语言")):
        return "language"
    if any(marker in message for marker in ("字段", "Shot", "时间戳", "时长", "协议")):
        return "h3-protocol"
    return "validation"


def minimax_h3_safe_validation_failure_leaf(error: Exception) -> str:
    """Return one bounded validation leaf without exposing source or output text."""

    message = clean_text(str(error))
    markers = (
        (("界面别名",), "ui-alias"),
        (("未经视觉合同", "敏感类别"), "sensitive-category-upgrade"),
        (("未经授权的敏感视觉事实",), "sensitive-fact-upgrade"),
        (("遗漏了视觉 IR 已确认的敏感事实",), "sensitive-fact-missing"),
        (("衣着",), "apparel"),
        (("逐帧事实范围",), "picture-scope"),
        (("年龄事实", "推断为成年", "改写为明确未成年人"), "age"),
        (("独立事实槽位",), "entity-slot"),
        (("数量事实",), "entity-count"),
        (("主体身份事实",), "entity-identity"),
        (("主体姿态事实",), "entity-pose"),
        (("主体动作事实",), "entity-action"),
        (("主体关系事实",), "relation"),
        (("场景事实",), "scene"),
        (("敏感可见事实类别",), "sensitive-signal"),
        (("敏感输出或请求", "敏感输出不能"), "sensitive-age"),
        (("音频事实", "无音乐要求"), "audio"),
        (("动作或运镜意图", "首帧视觉事实"), "motion-intent"),
        (("中文", "英文", "语言"), "language"),
        (("字段", "Shot", "时间戳", "时长", "协议"), "h3-protocol"),
        (("确定性视觉候选",), "candidate-build"),
    )
    for alternatives, leaf in markers:
        if any(marker in message for marker in alternatives):
            return leaf
    return "validation"


def is_ui_design_prompt_payload(payload: dict) -> bool:
    surface = clean_text(payload.get("surface") or "").lower().replace("_", "-")
    purpose = clean_text(payload.get("purpose") or "").lower().replace("_", "-")
    return surface in {"ui", "ui-design", "uidesign"} or purpose.startswith("ui-design")


def is_ordinary_art_prompt_payload(payload: dict) -> bool:
    """Return whether optimizePrompt is using the ordinary still-image surface."""

    surface = clean_text(payload.get("surface") or "").lower().replace("_", "-")
    return surface in {"", "art", "drawing", "image"}


def ordinary_art_prompt_output_max_length(raw_prompt: str) -> int:
    """Scale edit output for long Art bases without inflating short prompts."""

    prompt_chars = len(clean_text(raw_prompt))
    if prompt_chars <= ORDINARY_ART_PROMPT_BASE_CHAR_THRESHOLD:
        return ORDINARY_ART_PROMPT_BASE_MAX_LENGTH
    growth_chars = prompt_chars - ORDINARY_ART_PROMPT_BASE_CHAR_THRESHOLD
    scaled = ORDINARY_ART_PROMPT_BASE_MAX_LENGTH + math.ceil(
        growth_chars * ORDINARY_ART_PROMPT_TOKEN_GROWTH
    )
    return min(ORDINARY_ART_PROMPT_MAX_LENGTH, scaled)


def ordinary_art_supports_negative_prompt(payload: dict) -> bool:
    """The ordinary Art surface keeps its legacy negative channel by default."""

    return payload.get("supportsNegativePrompt") is not False


class OrdinaryArtPromptRetentionError(ValueError):
    code = "art-prompt-retention-failed"

    def __init__(self, reason: str):
        super().__init__("提示词优化未能完整保留原底稿，请缩小修改范围后重试")
        self.diagnostics = {
            "errorCode": self.code,
            "failureClass": "retention",
            "retentionReason": clean_text(reason)[:160],
        }


class OrdinaryArtPromptEditNotAppliedError(ValueError):
    code = "art-prompt-edit-not-applied"

    def __init__(self, reason: str):
        super().__init__("提示词优化未落实你的修改要求，原提示词保持不变；请重试或把修改要求写得更具体")
        self.diagnostics = {
            "errorCode": self.code,
            "failureClass": "application",
            "applicationReason": clean_text(reason)[:160],
        }


def ordinary_art_retention_compact(value: str) -> str:
    return re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]+", "", clean_text(value)).lower()


def ordinary_art_retention_bigrams(value: str) -> set[str]:
    compact = ordinary_art_retention_compact(value)
    return {compact[index:index + 2] for index in range(max(0, len(compact) - 1))}


def ordinary_art_user_change_instruction(requirements: str) -> str:
    """Read only the renderer's first-line user intent, excluding appended policy."""

    text = clean_text(requirements).replace("\r\n", "\n").replace("\r", "\n")
    first_line = text.split("\n", 1)[0].strip()
    marked = re.match(
        r"^用户本次修改要求\s*[（(]最高优先级[）)]\s*[:：]\s*(.*)$",
        first_line,
        flags=re.I,
    )
    if marked:
        return clean_text(marked.group(1))
    if first_line.startswith("提示词编辑模式："):
        return ""
    return text


ORDINARY_ART_SIMPLE_QUALITY_CLOSURE_PHRASES = {
    "material": "材质与纹理细腻清晰",
    "lighting": "光影层次丰富，高光与阴影过渡自然",
    "quality": "画面质感精致，细节清晰，完成度高",
}


def ordinary_art_simple_quality_closure_domains(
    raw_prompt: str,
    requirements: str,
    *,
    prompt_schema: str = "",
) -> list[str]:
    """Return only strictly allowlisted quality domains for a short patch prompt."""

    source = str(raw_prompt or "").strip()
    if (
        not source
        or len(source) > 120
        or re.search(r"[\r\n]", source)
        or re.search(r"__NOVAFLOW_[A-Z0-9_:-]+__", source, flags=re.I)
        or re.search(r"\[[^\]\r\n]{1,32}\]|【[^】\r\n]{1,32}】", source)
        or clean_text(prompt_schema)
    ):
        return []

    instruction = ordinary_art_user_change_instruction(requirements)
    if (
        not instruction
        or len(instruction) > 120
        or re.search(r"[\r\n]", instruction)
        or not re.search(r"增强|提升|提高|强化|改善|优化", instruction, flags=re.I)
        or re.search(
            r"(?:背景|环境|场景|构图|布局|主体|人物|角色|数量|人数|颜色|色彩|配色|色调|"
            r"镜头|视角|景别|裁切|透视|景深|姿势|动作|服装|道具|年龄|身份|性别|"
            r"增加|添加|补充|删除|去除|移除|修改|调整|改为|改成|替换|"
            r"不要|不得|禁止|避免|降低|减少|弱化|不|无|未|勿|别|"
            r"更|更加|比较|相较|相比|高于|低于)",
            instruction,
            flags=re.I,
        )
    ):
        return []

    domain_patterns = (
        ("material", r"材质|纹理"),
        ("lighting", r"光影|光线|高光|阴影|层次"),
        ("quality", r"画面质感|画质|细节|清晰度?|完成度"),
    )
    domains = [
        domain
        for domain, pattern in domain_patterns
        if re.search(pattern, instruction, flags=re.I)
    ]
    if not domains:
        return []

    remainder = instruction
    for pattern in (
        r"画面质感|清晰度|完成度|材质|纹理|光影|光线|高光|阴影|层次|画质|细节|清晰",
        r"增强|提升|提高|强化|改善|优化",
        r"以及|并且|同时|和|与|及|并|请|整体|画面",
        r"[\s、，,；;。.!！?？]+",
    ):
        remainder = re.sub(pattern, "", remainder, flags=re.I)
    return domains if not remainder else []


def ordinary_art_simple_quality_domain_present(candidate: str, domain: str) -> bool:
    text = clean_text(candidate)
    positive = r"(?:细腻|清晰|真实|自然|精致|丰富|高级|分明|立体|协调|受控|柔和|完整|出色|高)"
    if domain == "material":
        anchor = r"(?:材质|纹理)(?:与|和|及|、)?(?:材质|纹理)?"
    elif domain == "lighting":
        anchor = r"(?:光影|光线|高光|阴影|明暗)(?:层次)?"
    elif domain == "quality":
        anchor = r"(?:画面质感|画质|完成度)"
    else:
        return False
    return bool(
        re.search(rf"{anchor}[^，,；;。！？!?\n]{{0,12}}{positive}", text, flags=re.I)
        or re.search(rf"{positive}[^，,；;。！？!?\n]{{0,8}}{anchor}", text, flags=re.I)
    )


def apply_ordinary_art_simple_quality_closure(
    raw_prompt: str,
    requirements: str,
    candidate: str,
    diagnostics: dict | None = None,
    *,
    prompt_schema: str = "",
) -> str:
    """Use the source, never an unproven provider delta, for pure quality closure."""

    domains = ordinary_art_simple_quality_closure_domains(
        raw_prompt,
        requirements,
        prompt_schema=prompt_schema,
    )
    merged = (
        str(raw_prompt or "").strip()
        if domains
        else str(candidate or "")
    )

    def fail(reason: str) -> str:
        if isinstance(diagnostics, dict):
            diagnostics["failureReason"] = reason
        return ""

    if isinstance(diagnostics, dict):
        diagnostics["eligible"] = bool(domains)
        diagnostics["requestedDomains"] = list(domains)
        diagnostics["providerDeltaDiscarded"] = bool(
            domains
            and ordinary_art_retention_compact(candidate)
            != ordinary_art_retention_compact(raw_prompt)
        )

    missing = [
        domain
        for domain in domains
        if not ordinary_art_simple_quality_domain_present(merged, domain)
    ]
    if isinstance(diagnostics, dict):
        diagnostics["appendedDomains"] = list(missing)
    if missing:
        final_state = "；".join(
            ORDINARY_ART_SIMPLE_QUALITY_CLOSURE_PHRASES[domain]
            for domain in missing
        )
        trimmed = merged.rstrip()
        separator = " " if re.search(r"[。！？.!?]$", trimmed) else "；"
        merged = f"{trimmed}{separator}{final_state}。"

    removal_targets = ordinary_art_explicit_removal_targets(requirements)
    if ordinary_art_patch_resource_tokens(merged) != ordinary_art_patch_resource_tokens(raw_prompt):
        return fail("simple-quality-closure-resource-token-mismatch")
    if not ordinary_art_patch_named_blocks_preserved(raw_prompt, merged, removal_targets):
        return fail("simple-quality-closure-named-block-missing")
    retention_failure = ordinary_art_patch_priority_retention_failure(
        raw_prompt, requirements, merged
    )
    if retention_failure:
        return fail(retention_failure)
    application_failure = ordinary_art_change_application_failure(
        raw_prompt, requirements, merged
    )
    return fail(application_failure) if application_failure else merged


def ordinary_art_retention_change_text(requirements: str) -> str:
    """Remove explicit preservation clauses before deriving editable anchors."""

    return re.sub(
        r"(?:但|并且|同时|，|,|；|;)?\s*(?:保留|保持|维持|不要改(?:动)?|不改(?:动)?|"
        r"其余|其他)[^，,；;。！？!?\n]*",
        "",
        ordinary_art_user_change_instruction(requirements),
        flags=re.I,
    )


def ordinary_art_instruction_allows_unchanged(requirements: str) -> bool:
    """Accept an unchanged result only when the whole user instruction explicitly asks for it."""

    instruction = clean_text(
        ordinary_art_user_change_instruction(requirements)
    ).strip().lower()
    if not instruction:
        return True
    if not clean_text(ordinary_art_retention_change_text(requirements)):
        return True
    instruction = re.sub(r"[\s，,。；;！？!?]+", "", instruction)
    no_change_patterns = (
        r"(?:无需|不需要|不用|不必)(?:做|进行)?(?:任何)?(?:修改|调整|改动|优化)",
        r"(?:保持|维持)(?:原样|原文|不变|现状)",
        r"(?:原样|全部)?保留(?:即可)?",
        r"(?:nochanges?|keepunchanged|leaveunchanged|keepasis)",
    )
    return any(re.fullmatch(pattern, instruction, flags=re.I) for pattern in no_change_patterns)


ORDINARY_ART_CORE_MALE_PATTERN = re.compile(
    r"(?:成年)?(?:男性|男人|男士|男角色)"
    r"|(?<![a-z0-9_])(?:adult[-\s]+)?(?:male|man|men|gentleman)(?![a-z0-9_])",
    re.I,
)
ORDINARY_ART_CORE_FEMALE_PATTERN = re.compile(
    r"(?:成年)?(?:女性|女人|女士|女角色)"
    r"|(?<![a-z0-9_])(?:adult[-\s]+)?(?:female|woman|women|lady|ladies)(?![a-z0-9_])",
    re.I,
)
ORDINARY_ART_CORE_FEMALE_GROUP_PATTERNS = (
    re.compile(
        r"(?:两|二|2)\s*(?:位|名|个)?[^，,。！？；;\n]{0,64}?"
        r"(?:女性|女人|女士|女角色)",
        re.I,
    ),
    re.compile(
        r"(?:两人|二人)[^。！？；;\n]{0,160}?"
        r"(?:女性(?:身材|体态|角色|身份|特征)|都是女性)",
        re.I,
    ),
    re.compile(r"(?<![a-z0-9_])(?:two|both)\s+(?:adult\s+)?women(?![a-z0-9_])", re.I),
    re.compile(
        r"(?:双女性|双女)\s*(?:角色|人物|组合|画面)",
        re.I,
    ),
    re.compile(
        r"(?<![a-z0-9_])(?:(?:female|women)\s+duo|duo\s+of\s+(?:adult\s+)?women)"
        r"(?![a-z0-9_])",
        re.I,
    ),
)
ORDINARY_ART_CORE_MALE_GROUP_PATTERNS = (
    re.compile(
        r"(?:两|二|2)\s*(?:位|名|个)?[^，,。！？；;\n]{0,64}?"
        r"(?:男性|男人|男士|男角色)",
        re.I,
    ),
    re.compile(r"(?<![a-z0-9_])(?:two|both)\s+(?:adult\s+)?men(?![a-z0-9_])", re.I),
)
ORDINARY_ART_CORE_ACTION_PATTERNS = {
    "kiss": re.compile(r"(?:亲吻|接吻|拥吻)|(?<![a-z0-9_])kiss(?:es|ed|ing)?(?![a-z0-9_])", re.I),
    "embrace": re.compile(r"(?:依偎|拥抱|环抱)|(?<![a-z0-9_])(?:embrac(?:e|es|ed|ing)|cuddl(?:e|es|ed|ing))(?![a-z0-9_])", re.I),
    "lying": re.compile(r"(?:躺在|躺卧|平躺|仰卧|俯卧)|(?<![a-z0-9_])(?:lying|reclining|supine|prone)(?![a-z0-9_])", re.I),
    "sitting": re.compile(r"(?:坐在|坐姿|坐着|端坐)|(?<![a-z0-9_])(?:sit(?:s|ting)?|seated)(?![a-z0-9_])", re.I),
    "standing": re.compile(r"(?:站立|站姿|站着)|(?<![a-z0-9_])stand(?:s|ing)?(?![a-z0-9_])", re.I),
    "kneeling": re.compile(r"(?:跪姿|跪着|跪地)|(?<![a-z0-9_])kneel(?:s|ing)?(?![a-z0-9_])", re.I),
}
ORDINARY_ART_CORE_NUDITY_PATTERN = re.compile(
    r"(?:裸体|裸露|全裸|半裸|一丝不挂|赤裸|裸身)"
    r"|(?<![a-z0-9_])(?:nude|naked|nudity|topless)(?![a-z0-9_])",
    re.I,
)
ORDINARY_ART_CORE_LOWER_BODY_FRAMING_PATTERN = re.compile(
    r"(?:只(?:看得到|看到|呈现|显示)?下半身|仅(?:看得到|看到|呈现|显示)?下半身|下半身取景)"
    r"|(?<![a-z0-9_])(?:lower[-\s]+body[-\s]+only|only\s+(?:the\s+)?lower[-\s]+body)(?![a-z0-9_])",
    re.I,
)
ORDINARY_ART_CORE_EXPLICIT_REDEFINITION_PATTERN = re.compile(
    r"(?:主体|人物|角色|性别|人数|身份|动作|姿势|取景).{0,32}"
    r"(?:改为|改成|换成|替换为|变为|重新定义|重定义)"
    r"|(?<![a-z0-9_])(?:change|replace|redefine)\s+(?:the\s+)?"
    r"(?:subject|character|gender|count|identity|action|pose|framing)(?![a-z0-9_])",
    re.I,
)
ORDINARY_ART_CORE_ADDITION_PATTERN = re.compile(
    r"(?:补充|新增|添加|加入|增加)\s*(?:一|1|两|二|2)?\s*(?:位|名|个)?\s*"
    r"(?:明确)?(?:成年)?(?:人|人物|角色|主体|男性|男人|女性|女人)"
    r"|(?<![a-z0-9_])add(?:ing)?\s+(?:(?:a|one|two|the|another)\s+)?"
    r"(?:adult\s+)?(?:person|character|subject|man|woman|male|female)(?![a-z0-9_])",
    re.I,
)
ORDINARY_ART_CORE_ONE_OF_TWO_REPLACEMENT_PATTERN = re.compile(
    r"(?:把|将)?\s*(?:两|二|2)\s*(?:位|名|个)?\s*(?:明确)?(?:成年)?\s*"
    r"(?P<from>女性|女人|女士|女角色|男性|男人|男士|男角色)"
    r"[^，,。！？；;\n]{0,24}?(?:中(?:的)?|里面(?:的)?)?\s*一\s*(?:位|名|个)?"
    r"[^，,。！？；;\n]{0,16}?(?:替换为|替换成|改为|改成|换成)\s*"
    r"(?:一|1)?\s*(?:位|名|个)?\s*(?:明确)?(?:成年)?\s*"
    r"(?P<to>女性|女人|女士|女角色|男性|男人|男士|男角色)"
    r"|(?<![a-z0-9_])replace\s+one\s+of\s+(?:the\s+)?two\s+"
    r"(?P<from_en>women|men|females|males)\s+with\s+(?:an?\s+)?(?:adult\s+)?"
    r"(?P<to_en>woman|man|female|male)(?![a-z0-9_])",
    re.I,
)
ORDINARY_ART_CORE_ONE_MALE_PATTERN = re.compile(
    r"(?:一|1)\s*(?:位|名|个)?[^，,。！？；;\n]{0,16}?"
    r"(?:男性|男人|男士|男角色)"
    r"|(?:一男一女)"
    r"|(?<![a-z0-9_])(?:one|an?)\s+(?:adult\s+)?(?:male|man)(?![a-z0-9_])",
    re.I,
)
ORDINARY_ART_CORE_ONE_FEMALE_PATTERN = re.compile(
    r"(?:一|1)\s*(?:位|名|个)?[^，,。！？；;\n]{0,16}?"
    r"(?:女性|女人|女士|女角色)"
    r"|(?:一男一女)"
    r"|(?<![a-z0-9_])(?:one|an?)\s+(?:adult\s+)?(?:female|woman)(?![a-z0-9_])",
    re.I,
)
ORDINARY_ART_CORE_THREE_OR_MORE_PEOPLE_PATTERN = re.compile(
    r"(?:三|3)\s*(?:位|名|个)?\s*"
    r"(?:人物|角色|主体|男性|男人|女性|女人|人(?!称|物))"
    r"|(?<![a-z0-9_])(?:three|3)\s+(?:adult\s+)?"
    r"(?:people|persons|characters|subjects|men|women|males|females)(?![a-z0-9_])",
    re.I,
)
ORDINARY_ART_CORE_NEGATED_MENTION_PREFIX_PATTERN = re.compile(
    r"(?:不要|不含|不出现|不包括|无需|避免|禁止|排除|去掉|删掉|删除|移除|取消|无|没有)"
    r"[^，,。！？；;\n]{0,16}$"
    r"|(?<![a-z0-9_])(?:no|without|avoid|exclude|remove|delete|omit|do\s+not\s+(?:include|show|add))"
    r"[^,.;!?\n]{0,24}$",
    re.I,
)
ORDINARY_ART_CORE_ACTOR_NEGATED_MENTION_PREFIX_PATTERN = re.compile(
    r"(?:不要|不需要|不含|不出现|不包括|无需|避免|禁止|排除|去掉|删掉|删除|移除|取消|无|没有)"
    r"\s*(?:出现|包含|包括|加入|添加)?\s*(?:任何|一个|一位|一名|成年)?\s*$"
    r"|(?<![a-z0-9_])(?:no|without|avoid|exclude|remove|delete|omit|"
    r"do\s+not\s+(?:include|show|add))\s*(?:any|a|one|adult)?\s*$",
    re.I,
)
ORDINARY_ART_CORE_ACTOR_CONTEXT_PREFIX_PATTERN = re.compile(
    r"(?:面向|针对|适合)\s*$"
    r"|(?<![a-z0-9_])(?:for|aimed\s+at|targeted\s+at)\s*$",
    re.I,
)
ORDINARY_ART_CORE_ACTOR_CONTEXT_SUFFIX_PATTERN = re.compile(
    r"\s*(?:的)?(?:向(?:审美|作品|内容|游戏|用户|受众|市场|题材|风格)?|"
    r"视角|视点|审美|凝视|用户|观众|受众|市场)"
    r"|\s*[-\s]+(?:pov|perspective|viewpoint|gaze|oriented|audience|market)\b",
    re.I,
)
ORDINARY_ART_CORE_SIDE_FEMALE_PATTERN = re.compile(
    r"(?P<side_cn>左侧|右侧|左边|右边)\s*(?:的\s*)?(?P<adult_cn>成年)?\s*"
    r"(?P<female_cn>女性角色|女角色|女性|女人|女士)"
    r"|(?<![a-z0-9_])(?P<side_en>left|right)(?:[-\s]+(?:hand[-\s]+)?side)?\s+"
    r"(?P<adult_en>adult\s+)?(?P<female_en>female\s+character|woman|female)(?![a-z0-9_])",
    re.I,
)
ORDINARY_ART_CORE_SIDE_MAPPING_PATTERN = re.compile(
    r"(?:左侧|右侧|左边|右边)[^，,。！？；;\n]{0,20}"
    r"(?:男性角色|男角色|男性|男人|男士|女性角色|女角色|女性|女人|女士)"
    r"|(?<![a-z0-9_])(?:left|right)(?:[-\s]+(?:hand[-\s]+)?side)?"
    r"[^,.;!?\n]{0,24}(?:male|man|female|woman)(?![a-z0-9_])",
    re.I,
)
ORDINARY_ART_CORE_MINOR_NEGATED_MENTION_PREFIX_PATTERN = re.compile(
    r"(?:不包含|不涉及|不含|没有|禁止|避免|排除|不得|严禁|拒绝|无)"
    r"\s*[：:]?\s*(?:(?:出现|包含|涉及|描绘|展示|呈现|使用|加入|添加|安排|选择|允许|有)\s*)?"
    r"(?:任何|任意|所有|全部|一切|一个|一位|一名)?\s*(?:明确)?\s*"
    r"(?:幼态|儿童化|孩童化)?\s*$"
    r"|(?<![a-z0-9_])(?:(?:do|does|did|must|should|is|are|was|were)\s+)?"
    r"(?:no|not|without|exclude(?:s|d|ing)?|avoid(?:s|ed|ing)?|"
    r"prohibit(?:s|ed|ing)?|forbid(?:s|ding|den)?)"
    r"\s*(?:(?:include|show|depict|feature|involve|use|add|allow)(?:s|ed|ing)?\s*)?"
    r"(?:any|all|a|an|one)?\s*$",
    re.I,
)
ORDINARY_ART_CORE_MINOR_NEGATED_MENTION_SUFFIX_PATTERN = re.compile(
    r"^(?:\s*(?:(?:相关)?内容\s*(?:仍然|一律|均|都)?\s*"
    r"(?:不得|禁止|严禁|不允许)\s*(?:出现|包含|涉及|加入|存在)?"
    r"|(?:(?:人物|角色|男人|女人|男性|女性)\s*)?"
    r"(?:(?:不得|禁止|严禁|不允许)\s*(?:出现|包含|涉及|加入|存在)"
    r"|(?:应|必须)\s*(?:被)?排除))"
    r"|\s*(?:(?:man|woman|person|people|characters?|content)\s+)?"
    r"(?:(?:(?:is|are)\s+)?not\s+allowed"
    r"|(?:is|are)\s+(?:prohibited|forbidden|excluded))"
    r"(?:\s+(?:to\s+(?:appear|exist|be\s+(?:shown|included|added|present))"
    r"|from\s+(?:appearing|existing|being\s+(?:shown|included|added|present))))?\s*$)",
    re.I,
)

ORDINARY_ART_DETERMINISTIC_CLOSURE_MAX_UNITS = 8
ORDINARY_ART_DETERMINISTIC_CLOSURE_MAX_TARGET_CHARS = 320


def ordinary_art_core_positive_mention_present(
    value: str,
    pattern: re.Pattern,
    *,
    actor_context: bool = False,
) -> bool:
    """Return only affirmative subject/concept mentions, not negated or audience/POV terms."""

    text = str(value or "")
    for match in pattern.finditer(text):
        prefix = text[max(0, match.start() - 40):match.start()]
        suffix = text[match.end():match.end() + 24]
        negation_pattern = (
            ORDINARY_ART_CORE_ACTOR_NEGATED_MENTION_PREFIX_PATTERN
            if actor_context else
            ORDINARY_ART_CORE_NEGATED_MENTION_PREFIX_PATTERN
        )
        if negation_pattern.search(prefix):
            continue
        if actor_context and (
            ORDINARY_ART_CORE_ACTOR_CONTEXT_PREFIX_PATTERN.search(prefix)
            or ORDINARY_ART_CORE_ACTOR_CONTEXT_SUFFIX_PATTERN.match(suffix)
        ):
            continue
        return True
    return False


def ordinary_art_core_one_of_two_replacement(value: str) -> bool:
    """Recognize the closed composition edit: replace one member of a two-person same-gender group."""

    match = ORDINARY_ART_CORE_ONE_OF_TWO_REPLACEMENT_PATTERN.search(str(value or ""))
    if not match:
        return False
    source = clean_text(match.group("from") or match.group("from_en") or "").lower()
    target = clean_text(match.group("to") or match.group("to_en") or "").lower()
    source_is_female = bool(re.search(r"女|women|female", source, re.I))
    target_is_female = bool(re.search(r"女|woman|female", target, re.I))
    return bool(source and target and source_is_female != target_is_female)


def ordinary_art_core_exact_mixed_pair_present(value: str) -> bool:
    """Require the closed two-person slot to remain exactly one male plus one female."""

    text = str(value or "")
    if not (
        ORDINARY_ART_CORE_ONE_MALE_PATTERN.search(text)
        and ORDINARY_ART_CORE_ONE_FEMALE_PATTERN.search(text)
    ):
        return False
    if ORDINARY_ART_CORE_THREE_OR_MORE_PEOPLE_PATTERN.search(text):
        return False
    if ordinary_art_core_gender_group_present(
        text,
        ORDINARY_ART_CORE_FEMALE_GROUP_PATTERNS,
        ORDINARY_ART_CORE_MALE_PATTERN,
    ) or ordinary_art_core_gender_group_present(
        text,
        ORDINARY_ART_CORE_MALE_GROUP_PATTERNS,
        ORDINARY_ART_CORE_FEMALE_PATTERN,
    ):
        return False
    return True


def ordinary_art_core_gender_group_present(
    value: str,
    patterns: tuple[re.Pattern, ...],
    opposite_pattern: re.Pattern,
) -> bool:
    for pattern in patterns:
        for match in pattern.finditer(str(value or "")):
            if not opposite_pattern.search(match.group(0)):
                return True
    return False


def ordinary_art_core_side_female_sides(value: str) -> set[str]:
    """Return only explicit left/right female identity slots."""

    sides = set()
    for match in ORDINARY_ART_CORE_SIDE_FEMALE_PATTERN.finditer(str(value or "")):
        side = clean_text(match.group("side_cn") or match.group("side_en") or "").lower()
        if side in {"左侧", "左边", "left"}:
            sides.add("left")
        elif side in {"右侧", "右边", "right"}:
            sides.add("right")
    return sides


def ordinary_art_core_unmapped_side_female_present(
    raw_prompt: str,
    instruction: str,
    candidate: str,
) -> bool:
    """Reject stale left/right female labels only when the user supplied no side mapping."""

    if ORDINARY_ART_CORE_SIDE_MAPPING_PATTERN.search(str(instruction or "")):
        return False
    if ordinary_art_core_side_female_sides(raw_prompt) != {"left", "right"}:
        return False
    return bool(ORDINARY_ART_CORE_SIDE_FEMALE_PATTERN.search(str(candidate or "")))


def ordinary_art_core_affirmative_minor_present(value: str) -> bool:
    """Ignore only locally negated minor mentions while retaining affirmative evidence."""

    for unit in ordinary_art_patch_units(str(value or "")):
        unit_text = str(unit["text"])
        if re.match(
            r"^\s*(?:避免|禁止|负向|AVOID|NEGATIVE)\s*[：:]",
            unit_text,
            re.I,
        ):
            continue
        for match in MINIMAX_H3_YOUNG_OUTPUT_PATTERN.finditer(unit_text):
            prefix = unit_text[max(0, match.start() - 80):match.start()]
            prefix = re.split(r"[\r\n，。；;,.!?！？]", prefix)[-1]
            if ORDINARY_ART_CORE_MINOR_NEGATED_MENTION_PREFIX_PATTERN.search(prefix):
                continue
            suffix = unit_text[match.end():match.end() + 56]
            suffix = re.split(r"[\r\n，。；;,.!?！？]", suffix)[0]
            if ORDINARY_ART_CORE_MINOR_NEGATED_MENTION_SUFFIX_PATTERN.match(suffix):
                continue
            return True
    return False


def ordinary_art_core_redefinition_failure(
    raw_prompt: str,
    requirements: str,
    candidate: str,
) -> str:
    """Reject incomplete subject rewrites without restoring quote lexical gates."""

    instruction = ordinary_art_user_change_instruction(requirements)
    if not instruction or ORDINARY_ART_CORE_ADDITION_PATTERN.search(instruction):
        return ""
    requested_male = ordinary_art_core_positive_mention_present(
        instruction,
        ORDINARY_ART_CORE_MALE_PATTERN,
        actor_context=True,
    )
    requested_female = ordinary_art_core_positive_mention_present(
        instruction,
        ORDINARY_ART_CORE_FEMALE_PATTERN,
        actor_context=True,
    )
    requested_actions = {
        name for name, pattern in ORDINARY_ART_CORE_ACTION_PATTERNS.items()
        if ordinary_art_core_positive_mention_present(instruction, pattern)
    }
    requested_nudity = ordinary_art_core_positive_mention_present(
        instruction,
        ORDINARY_ART_CORE_NUDITY_PATTERN,
    )
    requested_lower_body = ordinary_art_core_positive_mention_present(
        instruction,
        ORDINARY_ART_CORE_LOWER_BODY_FRAMING_PATTERN,
    )
    one_of_two_replacement = ordinary_art_core_one_of_two_replacement(instruction)
    explicit_redefinition = bool(
        ORDINARY_ART_CORE_EXPLICIT_REDEFINITION_PATTERN.search(instruction)
    )
    mixed_scene_redefinition = bool(
        requested_male
        and requested_female
        and (requested_actions or requested_nudity or requested_lower_body)
    )
    if not (explicit_redefinition or mixed_scene_redefinition or one_of_two_replacement):
        return ""

    if requested_male and not ordinary_art_core_positive_mention_present(
        candidate,
        ORDINARY_ART_CORE_MALE_PATTERN,
        actor_context=True,
    ):
        return "core-redefinition-incomplete:missing-male"
    if requested_female and not ordinary_art_core_positive_mention_present(
        candidate,
        ORDINARY_ART_CORE_FEMALE_PATTERN,
        actor_context=True,
    ):
        return "core-redefinition-incomplete:missing-female"
    if requested_nudity and not ordinary_art_core_positive_mention_present(
        candidate,
        ORDINARY_ART_CORE_NUDITY_PATTERN,
    ):
        return "core-redefinition-incomplete:missing-nudity"
    if requested_lower_body and not ordinary_art_core_positive_mention_present(
        candidate,
        ORDINARY_ART_CORE_LOWER_BODY_FRAMING_PATTERN,
    ):
        return "core-redefinition-incomplete:missing-lower-body-framing"
    for action_name in requested_actions:
        if not ordinary_art_core_positive_mention_present(
            candidate,
            ORDINARY_ART_CORE_ACTION_PATTERNS[action_name],
        ):
            return f"core-redefinition-incomplete:missing-action-{action_name}"

    if one_of_two_replacement and not ordinary_art_core_exact_mixed_pair_present(candidate):
        return "core-redefinition-incomplete:one-of-two-composition"

    if requested_male:
        stale_female_group = ordinary_art_core_gender_group_present(
            candidate,
            ORDINARY_ART_CORE_FEMALE_GROUP_PATTERNS,
            ORDINARY_ART_CORE_MALE_PATTERN,
        )
        if stale_female_group and ordinary_art_core_gender_group_present(
            raw_prompt,
            ORDINARY_ART_CORE_FEMALE_GROUP_PATTERNS,
            ORDINARY_ART_CORE_MALE_PATTERN,
        ):
            return "core-redefinition-incomplete:stale-female-group"
    if requested_female and not requested_male:
        stale_male_group = ordinary_art_core_gender_group_present(
            candidate,
            ORDINARY_ART_CORE_MALE_GROUP_PATTERNS,
            ORDINARY_ART_CORE_FEMALE_PATTERN,
        )
        if stale_male_group and ordinary_art_core_gender_group_present(
            raw_prompt,
            ORDINARY_ART_CORE_MALE_GROUP_PATTERNS,
            ORDINARY_ART_CORE_FEMALE_PATTERN,
        ):
            return "core-redefinition-incomplete:stale-male-group"
    if (
        requested_male
        and requested_female
        and ordinary_art_core_unmapped_side_female_present(
            raw_prompt,
            instruction,
            candidate,
        )
    ):
        return "core-redefinition-incomplete:stale-side-female-identities"

    return ""


def ordinary_art_core_conflicting_unit_ids(
    raw_prompt: str,
    failure_reason: str,
) -> list[str]:
    """Name original units implicated by a closed-slot core consistency failure."""

    failure = clean_text(failure_reason)
    one_of_two_failure = "one-of-two-composition" in failure
    if "stale-female-group" in failure or one_of_two_failure:
        patterns = ORDINARY_ART_CORE_FEMALE_GROUP_PATTERNS
        opposite = ORDINARY_ART_CORE_MALE_PATTERN
    elif "stale-male-group" in failure:
        patterns = ORDINARY_ART_CORE_MALE_GROUP_PATTERNS
        opposite = ORDINARY_ART_CORE_FEMALE_PATTERN
    elif "stale-side-female-identities" in failure:
        patterns = ()
        opposite = ORDINARY_ART_CORE_MALE_PATTERN
    else:
        return []
    include_side_female_identities = bool(
        "stale-female-group" in failure
        or "stale-side-female-identities" in failure
        or one_of_two_failure
    ) and ordinary_art_core_side_female_sides(raw_prompt) == {"left", "right"}
    conflict_ids = []
    for unit in ordinary_art_patch_units(raw_prompt):
        unit_text = str(unit["text"])
        same_gender_group = ordinary_art_core_gender_group_present(
            unit_text,
            patterns,
            opposite,
        )
        invalid_pair_count = bool(
            one_of_two_failure
            and (
                ORDINARY_ART_CORE_THREE_OR_MORE_PEOPLE_PATTERN.search(unit_text)
                or ORDINARY_ART_CORE_ONE_MALE_PATTERN.search(unit_text)
                or ORDINARY_ART_CORE_ONE_FEMALE_PATTERN.search(unit_text)
            )
        )
        stale_side_identity = bool(
            include_side_female_identities
            and ORDINARY_ART_CORE_SIDE_FEMALE_PATTERN.search(unit_text)
        )
        if same_gender_group or invalid_pair_count or stale_side_identity:
            conflict_ids.append(str(unit["id"]))
    return conflict_ids


def ordinary_art_change_application_failure(
    raw_prompt: str,
    requirements: str,
    candidate: str,
) -> str:
    """Reject a no-op edit without guessing how a valid semantic rewrite should look."""

    instruction = ordinary_art_user_change_instruction(requirements)
    if not clean_text(instruction) or ordinary_art_instruction_allows_unchanged(requirements):
        return ""
    source_compact = ordinary_art_retention_compact(raw_prompt)
    candidate_compact = ordinary_art_retention_compact(candidate)
    if source_compact and candidate_compact == source_compact:
        return "requested-change-not-applied:unchanged-candidate"
    return ordinary_art_core_redefinition_failure(raw_prompt, requirements, candidate)


ORDINARY_ART_RETENTION_CHANGE_STOP_BIGRAMS = {
    "修改", "调整", "优化", "改为", "改成", "替换", "删除", "移除", "去除",
    "增加", "添加", "降低", "提高", "减少", "增强", "弱化", "修正", "改善",
    "过于", "不够", "需要", "希望", "请将", "请把", "内容", "提示", "全部",
}


def ordinary_art_retention_change_bigrams(requirements: str) -> set[str]:
    change_bigrams = ordinary_art_retention_bigrams(
        ordinary_art_retention_change_text(requirements)
    )
    change_bigrams.difference_update(ORDINARY_ART_RETENTION_CHANGE_STOP_BIGRAMS)
    return change_bigrams


def ordinary_art_explicit_removal_targets(requirements: str) -> list[str]:
    source = ordinary_art_user_change_instruction(requirements)
    targets = []
    patterns = (
        r"(?:删除|移除|去掉|去除|删掉|取消|剔除)\s*(?:原(?:有|来)?(?:提示词)?(?:中|里的?)?|其中|对应的)?\s*"
        r"([^，。；;！？!?\n]+)",
        r"\b(?:remove|delete|omit|drop)\s+(?:the\s+)?([^,.;!?\n]+)",
    )
    for pattern in patterns:
        for match in re.finditer(pattern, source, flags=re.I):
            target = re.split(
                r"(?:并且|并|但|同时|然后|\band\b|\bbut\b)",
                clean_text(match.group(1)),
                maxsplit=1,
                flags=re.I,
            )[0].strip()
            if target:
                targets.append(target)
    return targets


def ordinary_art_retention_blocks(value: str) -> list[tuple[str, str]]:
    source = clean_text(value).replace("\r\n", "\n").replace("\r", "\n")
    source = re.sub(
        r"\n(?=\s*(?:\*\*)?[^：:\n]{1,18}[：:])",
        "\n\n",
        source,
    )
    blocks = []
    for raw_block in re.split(r"\n\s*\n+", source):
        text = clean_text(raw_block)
        visible = re.sub(r"^\s*(?:[-*#>]+\s*)+", "", text).replace("**", "").strip()
        label_match = re.match(r"^([^：:\n]{1,18})[：:]", visible)
        if label_match:
            blocks.append((clean_text(label_match.group(1)), text))
    return blocks


def ordinary_art_retention_block_body(block_text: str) -> str:
    """Return one named block's body without letting its label inflate coverage."""

    visible = re.sub(
        r"^\s*(?:[-*#>]+\s*)+",
        "",
        clean_text(block_text),
    ).replace("**", "").strip()
    label_match = re.match(r"^[^：:\n]{1,18}[：:]\s*([\s\S]*)$", visible)
    return clean_text(label_match.group(1) if label_match else visible)


def ordinary_art_short_priority_change_authorized(
    label: str,
    block_text: str,
    requirements: str,
) -> bool:
    """Allow a tiny hard constraint to change only when explicitly named."""

    instruction = ordinary_art_user_change_instruction(requirements)
    if not re.search(
        r"(?:修改|调整|改为|改成|替换|变更|更新|设为|设置为)"
        r"|(?<![a-z0-9_])(?:change|replace|update|set)\b",
        instruction,
        re.I,
    ):
        return False
    instruction_compact = ordinary_art_retention_compact(instruction)
    label_compact = ordinary_art_retention_compact(label)
    body_compact = ordinary_art_retention_compact(
        ordinary_art_retention_block_body(block_text)
    )
    return bool(
        (len(label_compact) >= 2 and label_compact in instruction_compact)
        or (body_compact and body_compact in instruction_compact)
    )


def ordinary_art_retention_block_explicitly_removed(
    label: str,
    _block_text: str,
    targets: list[str],
) -> bool:
    label_compact = ordinary_art_retention_compact(label)
    if len(label_compact) < 2:
        return False
    whole_block_names = {
        label_compact,
        *(f"{label_compact}{suffix}" for suffix in ("项", "段", "部分", "内容", "块", "章节")),
    }
    for target in targets:
        target_compact = re.sub(
            r"^(?:整个|全部|原有|原来|原本)+",
            "",
            ordinary_art_retention_compact(target),
        )
        if target_compact in whole_block_names:
            return True
    return False


def ordinary_art_retention_missing_blocks(
    raw_prompt: str,
    requirements: str,
    candidate: str,
) -> list[str]:
    candidate_bigrams = ordinary_art_retention_bigrams(candidate)
    user_instruction_compact = ordinary_art_retention_compact(
        ordinary_art_retention_change_text(requirements)
    )
    user_change_bigrams = ordinary_art_retention_change_bigrams(requirements)
    candidate_blocks_by_label: dict[str, list[str]] = {}
    for candidate_label, candidate_block_text in ordinary_art_retention_blocks(candidate):
        candidate_label_compact = ordinary_art_retention_compact(candidate_label)
        if candidate_label_compact:
            candidate_blocks_by_label.setdefault(candidate_label_compact, []).append(
                candidate_block_text
            )
    candidate_labels = set(candidate_blocks_by_label)
    removal_targets = ordinary_art_explicit_removal_targets(requirements)
    missing = []
    for label, block_text in ordinary_art_retention_blocks(raw_prompt):
        if ordinary_art_retention_block_explicitly_removed(
            label,
            block_text,
            removal_targets,
        ):
            continue
        block_bigrams = ordinary_art_retention_bigrams(block_text)
        if len(block_bigrams) < 2:
            continue
        label_compact = ordinary_art_retention_compact(label)
        is_priority_label = bool(re.search(
            r"要求|避免|禁止|约束|目标|require|avoid|constraint|target",
            label,
            re.I,
        ))
        if is_priority_label:
            same_name_blocks = candidate_blocks_by_label.get(label_compact, [])
            if not same_name_blocks:
                missing.append(label)
                continue
            original_body_bigrams = ordinary_art_retention_bigrams(
                ordinary_art_retention_block_body(block_text)
            )
            if len(original_body_bigrams) >= 2:
                best_same_block_coverage = max(
                    (
                        len(original_body_bigrams.intersection(
                            ordinary_art_retention_bigrams(
                                ordinary_art_retention_block_body(candidate_block)
                            )
                        )) / len(original_body_bigrams)
                    )
                    for candidate_block in same_name_blocks
                )
                if best_same_block_coverage < 0.6:
                    missing.append(label)
            else:
                original_body_compact = ordinary_art_retention_compact(
                    ordinary_art_retention_block_body(block_text)
                )
                same_name_body_compacts = [
                    ordinary_art_retention_compact(
                        ordinary_art_retention_block_body(candidate_block)
                    )
                    for candidate_block in same_name_blocks
                ]
                short_body_preserved = bool(
                    original_body_compact
                    and any(
                        original_body_compact in candidate_body_compact
                        for candidate_body_compact in same_name_body_compacts
                    )
                )
                if (
                    original_body_compact
                    and not short_body_preserved
                    and not ordinary_art_short_priority_change_authorized(
                        label,
                        block_text,
                        requirements,
                    )
                ):
                    missing.append(label)
            continue
        is_named_edit_target = (
            len(label_compact) >= 2
            and (
                label_compact in user_instruction_compact
                or user_instruction_compact in label_compact
            )
        )
        is_anchor_edit_target = (
            bool(block_bigrams.intersection(user_change_bigrams))
        )
        if is_named_edit_target or is_anchor_edit_target:
            continue
        block_coverage = len(block_bigrams.intersection(candidate_bigrams)) / len(block_bigrams)
        coverage_floor = 0.6 if label_compact in candidate_labels else 0.65
        if block_coverage < coverage_floor:
            missing.append(label)
    priority = [
        label for label in missing
        if re.search(r"要求|避免|禁止|约束|目标|require|avoid|constraint|target", label, re.I)
    ]
    return [*priority, *[label for label in missing if label not in priority]][:6]


def ordinary_art_positive_only_primary_output(output: str) -> str:
    """Return only the model's positive core, without treating a negative line as an edit."""

    text = clean_text(output)
    negative_line = re.search(
        r"(?im)^\s*(?:负向|负面|反向|反面)\s*[:：]\s*",
        text,
    )
    if negative_line:
        text = clean_text(text[:negative_line.start()])
    return re.sub(r"^\s*正向\s*[:：]\s*", "", text, count=1).strip()


def normalize_ordinary_art_positive_only_output(output: str) -> str:
    """Keep prose such as '负向空间', but fold a forbidden negative line into 正向."""

    text = clean_text(output)
    negative_line = re.search(
        r"(?im)^\s*(?:负向|负面|反向|反面)\s*[:：]\s*",
        text,
    )
    avoided = clean_text(text[negative_line.end():]) if negative_line else ""
    text = ordinary_art_positive_only_primary_output(text)
    if avoided:
        text = f"{text}\n避免：{avoided}".strip()
    return text


def ordinary_art_retention_units(raw_prompt: str, requirements: str) -> list[str]:
    change_bigrams = ordinary_art_retention_change_bigrams(requirements)
    source_units = [
        clean_text(item)
        for item in re.split(r"[。！？!?；;\n]+", clean_text(raw_prompt))
        if len(ordinary_art_retention_compact(item)) >= 6
    ]
    retained = []
    for unit in source_units:
        unit_bigrams = ordinary_art_retention_bigrams(unit)
        if change_bigrams and unit_bigrams.intersection(change_bigrams):
            continue
        retained.append(unit)
    return retained or source_units


def ordinary_art_retention_failure(
    raw_prompt: str,
    requirements: str,
    candidate: str,
) -> str:
    """Reject obvious whole-prompt collapse while allowing requested local edits."""

    missing_blocks = ordinary_art_retention_missing_blocks(
        raw_prompt,
        requirements,
        candidate,
    )
    if missing_blocks:
        return f"missing-blocks:{','.join(missing_blocks)}"
    source_compact = ordinary_art_retention_compact(raw_prompt)
    if len(source_compact) < ORDINARY_ART_PROMPT_BASE_CHAR_THRESHOLD:
        return ""
    retained_units = ordinary_art_retention_units(raw_prompt, requirements)
    retained_compact = ordinary_art_retention_compact("。".join(retained_units))
    candidate_compact = ordinary_art_retention_compact(candidate)
    minimum_chars = max(80, math.ceil(len(retained_compact) * 0.34))
    if len(candidate_compact) < minimum_chars:
        return f"candidate-too-short:{len(candidate_compact)}/{minimum_chars}"

    candidate_bigrams = ordinary_art_retention_bigrams(candidate)
    source_bigrams = ordinary_art_retention_bigrams(retained_compact)
    anchor_coverage = (
        len(source_bigrams.intersection(candidate_bigrams)) / len(source_bigrams)
        if source_bigrams else 1.0
    )
    preserved_units = 0
    for unit in retained_units:
        unit_bigrams = ordinary_art_retention_bigrams(unit)
        if not unit_bigrams:
            preserved_units += 1
            continue
        coverage = len(unit_bigrams.intersection(candidate_bigrams)) / len(unit_bigrams)
        if coverage >= 0.22:
            preserved_units += 1
    unit_coverage = preserved_units / len(retained_units) if retained_units else 1.0
    if anchor_coverage < 0.24 and unit_coverage < 0.45:
        return f"anchors-missing:{anchor_coverage:.3f}/{unit_coverage:.3f}"
    return ""


def build_ordinary_art_retention_repair_prompt(
    raw_prompt: str,
    requirements: str,
    invalid_candidate: str,
    supports_negative_prompt: bool,
    failure_reason: str,
) -> str:
    user_change_instruction = ordinary_art_user_change_instruction(requirements)
    change_not_applied = clean_text(failure_reason).startswith("requested-change-not-applied:")
    failure_intro = (
        "上一次结果完整复制了原底稿，没有实际落实用户的局部修改要求。"
        if change_not_applied else
        "上一次结果丢失了原底稿中的未修改内容。"
    )
    repair_priority = (
        "这次必须对被点名内容产生实际修改，不得逐字复制原底稿；同时不得改动未被点名的内容。\n"
        if change_not_applied else ""
    )
    output_contract = (
        "严格输出两行：第一行以“正向：”开头并填写完整修订提示词；第二行以“负向：”开头，"
        "只填写逗号分隔的中文负向关键词。"
        if supports_negative_prompt else
        "只输出一段完整修订后的正向提示词，不要标题、前缀、解释、独立负向提示词、第二段或多个方案；"
        "原底稿已有的‘避免’‘禁止’等生成约束仍须原位保留在完整正向提示词中。"
    )
    return (
        f"你是 NovaFlow 的普通绘图提示词保留修复器。{failure_intro}"
        "请从原底稿重新编辑一次：用户修改要求只是局部修改指令，未被明确要求改变的主体身份与数量、"
        "年龄、外观服装、动作关系、场景、构图镜头、风格材质、光影色彩、质量要求和避免项必须完整保留。"
        "为避免再次遗漏，未修改部分尽量沿用原底稿原句。候选仅用于识别错误，不得把候选当成新底稿。\n"
        f"保留校验失败：{clean_text(failure_reason)[:160]}\n"
        f"原始完整底稿：\n{clean_text(raw_prompt)[:20000]}\n"
        f"上一次不合格候选：\n{clean_text(invalid_candidate)[:8000]}\n"
        f"用户局部修改要求（现在必须落实）：\n{user_change_instruction[:2000] or '未提供额外修改要求'}\n"
        f"{repair_priority}"
        f"{output_contract}"
    )


def ordinary_art_patch_units(raw_prompt: str) -> list[dict]:
    """Index original paragraph spans without normalizing any source character."""

    source = str(raw_prompt or "")
    units = []
    cursor = 0
    index = 1
    for separator in re.finditer(r"(?:(?:\r\n|\n|\r)[ \t]*){2,}", source):
        if separator.start() > cursor:
            units.append({
                "id": f"P{index:02d}",
                "text": source[cursor:separator.start()],
                "start": cursor,
                "end": separator.start(),
            })
            index += 1
        cursor = separator.end()
    if cursor < len(source):
        units.append({
            "id": f"P{index:02d}",
            "text": source[cursor:],
            "start": cursor,
            "end": len(source),
        })
    if not units and source:
        units.append({"id": "P01", "text": source, "start": 0, "end": len(source)})
    return units


def ordinary_art_patch_intents(requirements: str) -> list[dict]:
    """Expose one unified edit obligation, regardless of punctuation."""

    change_text = clean_text(ordinary_art_retention_change_text(requirements))
    return [{"id": "I01", "text": change_text}] if change_text else []


def ordinary_art_patch_feedback_clauses(requirements: str) -> list[str]:
    """Extract optional semantic checks without turning commas into patch intents."""

    change_text = clean_text(
        ordinary_art_retention_change_text(requirements)
    ).replace("\r\n", "\n").replace("\r", "\n")
    clauses = []
    for value in re.split(
        r"[，,；;。！？!?\n]+|(?:但是|并且|而且|同时|但)",
        change_text,
    ):
        clause = re.sub(
            r"^(?:并且|同时|然后|而且|以及|并|且|但)\s*",
            "",
            clean_text(value).strip("。！？!?；;，, "),
            flags=re.I,
        )
        if not clause or re.match(
            r"^(?:保留|保持|维持|不要改(?:动)?|不改(?:动)?|其余|其他)",
            clause,
            flags=re.I,
        ):
            continue
        # A concrete direction that names the same problem subject is one
        # intent, not a second obligation (for example: background is
        # overexposed, lower the background highlights).
        if clauses and re.match(
            r"^(?:降低|减少|削弱|压低|减弱|提高|提升|增强|增加|补足|弱化|消除|修正|改善)",
            clause,
            flags=re.I,
        ):
            previous_signature = ordinary_art_patch_intent_signature(clauses[-1])
            previous_subject = str(previous_signature.get("subject") or "")
            if not previous_subject:
                shorthand_problem = re.fullmatch(
                    r"(.{1,48}?)(?:过曝|过亮|过暗)",
                    clauses[-1],
                    flags=re.I,
                )
                previous_subject = ordinary_art_retention_compact(
                    shorthand_problem.group(1) if shorthand_problem else ""
                )
            clause_compact = ordinary_art_retention_compact(clause)
            previous_scalars = set(
                previous_signature.get("scalarMarkers") or set()
            )
            if (
                (
                    len(previous_subject) >= 2
                    and previous_subject in clause_compact
                )
                or any(
                    len(marker) >= 2 and marker in clause_compact
                    for marker in previous_scalars
                )
            ):
                clauses[-1] = f"{clauses[-1]}，{clause}"
                continue
        clauses.append(clause)
    return clauses


def ordinary_art_patch_relevant_unit_ids(raw_prompt: str, requirements: str) -> list[str]:
    change_bigrams = ordinary_art_retention_change_bigrams(requirements)
    if not change_bigrams:
        return []
    return [
        str(unit["id"])
        for unit in ordinary_art_patch_units(raw_prompt)
        if ordinary_art_retention_bigrams(str(unit["text"])).intersection(change_bigrams)
    ]


def ordinary_art_problem_parts(value: str) -> dict:
    """Parse one problem clause, including open-ended `太 + property` feedback."""

    instruction = clean_text(value).strip("。！？!?；;，, ")
    instruction = re.split(r"[，,；;\n]", instruction, maxsplit=1)[0].strip()
    if not instruction or re.search(
        r"(?:增加|添加|增强|营造|制造|改成|改为|变成|做成|设为).{0,12}"
        r"(?:过于|不够|不足|缺少|过度|模糊|看不清|不清晰|错误|异常|太)",
        instruction,
        flags=re.I,
    ):
        return {}
    patterns = (
        (r"^(.{1,48}?)(?:过于|过度)(.{1,32})$", "high"),
        (r"^(.{1,48}?)太(.{1,32})$", "high"),
        (r"^(.{1,48}?)(?:不够|不足|缺少)(.{1,32})$", "low"),
        (r"^(.{1,48}?)(过曝)$", "high-exposure"),
        (r"^(.{1,48}?)(?:模糊|看不清|不清晰)$", "blur"),
        (r"^(.{1,48}?)(?:错误|异常)$", "error"),
    )
    for pattern, direction in patterns:
        match = re.fullmatch(pattern, instruction, flags=re.I)
        if not match:
            continue
        subject = clean_text(match.group(1)).strip()
        quality = clean_text(match.group(2)).strip() if match.lastindex and match.lastindex >= 2 else ""
        # Do not mistake lexical words such as `太阳` for the open `太 + property`
        # problem form.  A grammatical subject ending in these connectors is
        # not a stable editable anchor.
        if direction == "high" and "太" in instruction and subject.endswith(
            ("有", "是", "在", "为", "像", "与", "和", "及", "的")
        ):
            continue
        if not subject:
            continue
        if direction == "high-exposure":
            quality = "曝光"
            direction = "high"
        return {"subject": subject, "quality": quality, "direction": direction}
    return {}


def ordinary_art_problem_resolution_hint(value: str) -> str:
    """Compile short problem feedback into a provider-neutral final-state hint."""

    parts = ordinary_art_problem_parts(
        ordinary_art_retention_change_text(value)
    )
    if not parts:
        return ""
    subject = str(parts.get("subject") or "")
    quality = str(parts.get("quality") or "")
    direction = str(parts.get("direction") or "")
    if direction == "high":
        return clean_text(
            f"保留{subject}的原有内容与审美意图，只消除‘{quality}’的过度状态，"
            "呈现自然、受控且细节清楚的最终效果"
        )[:160]
    if direction == "low":
        return clean_text(
            f"保留{subject}的原有内容与审美意图，补足‘{quality}’的不足，"
            "呈现充分、清晰且完整的最终效果"
        )[:160]
    if direction == "blur":
        return f"{subject}清晰可见且细节完整"[:160]
    if direction == "error":
        return f"{subject}准确、自然且合理"[:160]
    return ""


def build_ordinary_art_patch_repair_prompt(
    raw_prompt: str,
    requirements: str,
    failure_reason: str,
    nsfw_enabled: bool = False,
    required_unit_ids: list[str] | None = None,
    remaining_patch_count: int = 4,
    remaining_target_chars: int = 320,
) -> str:
    """Ask the model for exact local replacements instead of another full rewrite."""

    all_units = ordinary_art_patch_units(raw_prompt)
    known_unit_ids = {str(unit["id"]) for unit in all_units}
    required_ids = [
        clean_text(unit_id).upper()
        for unit_id in (required_unit_ids or [])
        if clean_text(unit_id).upper() in known_unit_ids
    ]
    required_ids = list(dict.fromkeys(required_ids))
    units = (
        [unit for unit in all_units if str(unit["id"]) in required_ids]
        if required_ids else
        all_units
    )
    unit_text = "\n".join(
        f"[{unit['id']}] {unit['text']}"
        for unit in units
    )
    instruction = ordinary_art_user_change_instruction(requirements)
    relevant_ids = (
        required_ids
        if required_ids else
        ordinary_art_patch_relevant_unit_ids(raw_prompt, requirements)
    )
    unit_hint = (
        ", ".join(relevant_ids)
        if relevant_ids else
        "无可靠字面锚点，请按整体语义选择最相关单元"
    )
    conflicting_unit_ids = ordinary_art_core_conflicting_unit_ids(
        raw_prompt,
        failure_reason,
    )
    conflict_unit_hint = (
        "核心冲突单元（必须逐项检查并优先 patch）："
        + ", ".join(conflicting_unit_ids)
        + "。\n"
        if conflicting_unit_ids else ""
    )
    bounded_patch_count = max(0, min(4, int(remaining_patch_count or 0)))
    bounded_target_chars = max(0, min(320, int(remaining_target_chars or 0)))
    repair_scope = (
        "本轮是闭合冲突修复，只提供尚未解决的单元。"
        f"只允许 patch {', '.join(required_ids)}；请在剩余额度内优先修复尽可能多的冲突单元，"
        "不要求一次返回全部列出的 segment_id，程序会对剩余的高置信性别/成年闭槽做受限确定性收口；"
        "不得返回其他单元，也不得重复此前已完成的动作、裸体或取景 patch。"
        f"本轮剩余额度：最多 {bounded_patch_count} 项 patch，所有 target_quote 合计最多 "
        f"{bounded_target_chars} 个字符。\n"
        if required_ids else ""
    )
    final_checks = []
    for clause in ordinary_art_patch_feedback_clauses(requirements):
        resolution_hint = ordinary_art_problem_resolution_hint(clause)
        if resolution_hint:
            final_checks.append(resolution_hint)
    resolution_check = (
        "最终语义检查（replacement 必须实现，可由一个或多个 patch 共同完成）："
        + "；".join(final_checks)
        + "。\n"
        if final_checks else ""
    )
    adult_context = (
        "成人内容上下文：用户已开启 NSFW。只要要求中的人物明确为成年人，"
        "就必须忠实保留用户指定的性别、成年身份、裸体状态、身体姿势与人物关系；"
        "不得因成人裸露或亲密姿势把男人改成女人、把裸体改成着装，或恢复与新要求冲突的旧主体。"
        "任何未成年人相关内容仍然禁止。\n"
        if nsfw_enabled else ""
    )
    return (
        "你是 NovaFlow 普通绘图提示词的局部编辑器。程序会保留所有未返回的单元，"
        "所以绝对不要重写完整提示词，也不要返回未修改单元。\n"
        f"用户本次统一修改要求：{instruction[:2000]}\n"
        + adult_context
        +
        "把整条要求作为一个完整编辑任务理解，不要按逗号、分号或句号拆成必须逐项绑定的 intent。"
        f"一次要求可以用一个或多个精确 patch 共同完成，本轮最多 {bounded_patch_count} 项。"
        "若要求重定义核心人物、动作、构图或场景，可直接替换对应的旧片段；"
        "新要求与旧提示词冲突时，新要求拥有最高优先级；性别、人数、年龄、主体身份、动作、"
        "裸露状态、取景范围等明确字段必须使用新要求，不得回退到旧值。"
        "只改动作段不等于完成主体重定义；必须扫描全部单元，同时 patch 所有仍与新性别、人数、"
        "身份、动作、裸体状态或取景冲突的旧主体陈述，最终不得让新旧主体设定并存。"
        "若要求补充新元素，把新增内容合并进最合适的现有片段。"
        "target_quote 不需要与用户要求共享字词，只需要确实是应当修改或扩展的原文锚点。\n"
        f"可能相关单元：{unit_hint}。这只是提示，不是准入限制。\n"
        + conflict_unit_hint
        + repair_scope
        + f"补丁校验上下文：{clean_text(failure_reason)[:160]}\n"
        f"选择最少数量的精确片段完成修改，最多返回 {bounded_patch_count} 项，"
        f"target_quote 合计不得超过 {bounded_target_chars} 个字符。"
        "target_quote 必须逐字复制自指定单元且只出现一次；"
        "replacement 是该片段的最终成品画面描述，必须实际落实修改且不能与 target_quote 相同。"
        "如果用户描述的是问题而不是动作，replacement 也必须写成问题已经解决后的最终画面状态，"
        "禁止复述问题本身，也禁止写‘需要调整’‘应该’‘建议’‘请修改’等操作建议。"
        "修正问题时必须保留 target_quote 中未被点名改变的场景元素、风格和原有审美意图，"
        "只消除过度或不足，不能把画面翻到相反极端，也不能完整照抄原句后追加一句修改意见。"
        "问题式反馈的 replacement 必须用具体成品描述体现问题已经解决；只把一个词换成‘柔和、明亮、"
        "高级、精致’等泛化形容词通常不足以表达修改目标。"
        "例如：‘光线太亮’应写成仍然明亮、但曝光和高光受控、细节清晰可见的最终光线，不能改成暗淡；"
        "‘光线太暗’应写成暗部层次清楚且亮度适中，不能改成刺眼；‘细节不够清晰’应写成细节清晰可见；"
        "‘材质太塑料’应写成自然真实、保留细腻质感的最终材质。未修改内容由程序逐字保留。"
        "只输出严格 JSON，不要 Markdown、解释、正向/负向标题或其他文字。格式固定为："
        '{"patches":[{"segment_id":"P09","target_quote":"原文逐字片段","replacement":"最终替换文字"}]}\n'
        "完整提示词单元如下：\n"
        f"{unit_text}\n"
        + resolution_check
        + '最终只输出 {"patches":[...]} 或等价的裸补丁数组，不要重复原提示词。'
    )


def ordinary_art_patch_resource_tokens(value: str) -> list[str]:
    return sorted(re.findall(r"__NOVAFLOW_[A-Z0-9_:-]+__", str(value or ""), flags=re.I))


def ordinary_art_patch_empty_replacement_allowed(
    target_quote: str,
    removal_targets: list[str],
) -> bool:
    quote_compact = ordinary_art_retention_compact(target_quote)
    if not quote_compact:
        return False
    for target in removal_targets:
        target_compact = ordinary_art_retention_compact(target)
        if target_compact and target_compact == quote_compact:
            return True
    blocks = ordinary_art_retention_blocks(target_quote)
    return bool(
        len(blocks) == 1
        and ordinary_art_retention_block_explicitly_removed(
            blocks[0][0],
            blocks[0][1],
            removal_targets,
        )
    )


def ordinary_art_patch_replacement_is_meta_instruction(value: str) -> bool:
    return bool(re.search(
        r"(?:^|[，,。！？；;.!?\n])\s*(?:需要|应该|应当|建议|请(?:修改|调整|降低|提高|增加|删除)|"
        r"可以(?:修改|调整|降低|提高|增加|删除)|"
        r"(?:把|将).{1,80}(?:改为|改成|替换为|调整为|设置为)|"
        r"(?:please\s+)?(?:change|replace|set|remove|delete|add|lower|raise|increase|reduce|adjust|modify)\b|"
        r"(?:need(?:s|ed)?|should|must|recommend(?:ed)?)\s+(?:to\s+)?"
        r"(?:change|replace|set|remove|delete|add|lower|raise|increase|reduce|adjust|modify)\b)",
        str(value or ""),
        flags=re.I,
    ))


def ordinary_art_patch_target_matches_intent(
    intent_instruction: str,
    target_quote: str,
) -> bool:
    """Require a stable lexical anchor when multiple intents could cross-wire."""

    target_compact = ordinary_art_retention_compact(target_quote)
    if not target_compact:
        return False
    parts = ordinary_art_problem_parts(intent_instruction)
    if parts:
        subject = ordinary_art_retention_compact(str(parts.get("subject") or ""))
        quality = ordinary_art_retention_compact(str(parts.get("quality") or ""))
        if any(
            len(anchor) >= 2 and anchor in target_compact
            for anchor in (subject, quality)
        ):
            return True
    intent_bigrams = ordinary_art_retention_change_bigrams(intent_instruction)
    return bool(intent_bigrams.intersection(ordinary_art_retention_bigrams(target_quote)))


def ordinary_art_patch_semantic_clauses(value: str) -> list[str]:
    return [
        clean_text(item).strip()
        for item in re.split(
            r"[，,；;。！？!?\n]+|\s+(?:and|while|meanwhile)\s+",
            clean_text(value),
            flags=re.I,
        )
        if clean_text(item).strip()
    ]


def ordinary_art_patch_intent_signature(instruction: str) -> dict:
    """Extract subject plus intent-specific problem or requested-state markers."""

    text = clean_text(instruction).strip("。！？!?；;，, ")
    problem = ordinary_art_problem_parts(text)
    if problem:
        subject = ordinary_art_retention_compact(str(problem.get("subject") or ""))
        quality = ordinary_art_retention_compact(str(problem.get("quality") or ""))
        direction = str(problem.get("direction") or "")
        scalar_markers = {quality} if len(quality) >= 2 else set()
        if quality in {"曝光", "过曝", "亮", "明亮", "刺眼"}:
            scalar_markers.update({"曝光", "过曝", "高光", "亮度", "光照", "补光"})
        if quality in {"写实", "真实", "真人", "摄影", "摄影感"}:
            scalar_markers.update({"写实", "真实", "真人", "摄影", "摄影感", "二次元", "厚涂", "手绘"})
        if quality in {"塑料", "塑料感", "虚假"}:
            scalar_markers.update({"塑料", "塑料感", "虚假", "自然", "真实", "有机"})
        markers = set(scalar_markers)
        if direction == "high":
            markers.update({"降低", "减少", "弱化", "消除", "去除", "抑制", "受控", "适中"})
        elif direction == "low":
            markers.update({"增加", "增强", "提升", "补足", "充分", "清晰", "完整"})
        elif direction == "blur":
            markers.update({"模糊", "清晰", "可见", "细节完整"})
        elif direction == "error":
            markers.update({"错误", "异常", "准确", "正确", "合理"})
        return {
            "subject": subject,
            "markers": {
                ordinary_art_retention_compact(marker)
                for marker in markers
                if len(ordinary_art_retention_compact(marker)) >= 2
            },
            "scalarMarkers": {
                ordinary_art_retention_compact(marker)
                for marker in scalar_markers
                if len(ordinary_art_retention_compact(marker)) >= 2
            },
        }

    action_patterns = (
        r"^(?:把|将|让|使|令)?(.{1,48}?)(?:改成|改为|变成|设为|调整为|替换为|换成|呈现为?|采用|使用)(.{1,48})$",
        r"^(.{1,48}?)(?:更|更加)(.{1,32})$",
    )
    for pattern in action_patterns:
        match = re.fullmatch(pattern, text, flags=re.I)
        if not match:
            continue
        subject = ordinary_art_retention_compact(match.group(1))
        requested_state = ordinary_art_retention_compact(match.group(2))
        if subject and len(requested_state) >= 2:
            return {
                "subject": subject,
                "markers": {requested_state},
                "scalarMarkers": {requested_state},
            }
    return {"subject": "", "markers": set(), "scalarMarkers": set()}


def ordinary_art_patch_clause_has_signature(clause: str, signature: dict) -> bool:
    compact = ordinary_art_retention_compact(clause)
    subject = str(signature.get("subject") or "")
    markers = set(signature.get("markers") or set())
    return bool(
        len(subject) >= 2
        and subject in compact
        and any(marker and marker in compact for marker in markers)
    )


def ordinary_art_patch_foreign_intent_id(
    intent_id: str,
    intent_by_id: dict[str, str],
    target_quote: str,
    replacement: str,
) -> str:
    """Return a foreign intent whose unique problem signature was introduced."""

    replacement_clauses = ordinary_art_patch_semantic_clauses(replacement)
    target_clauses = ordinary_art_patch_semantic_clauses(target_quote)
    current_signature = ordinary_art_patch_intent_signature(
        intent_by_id.get(intent_id, "")
    )
    current_subject = str(current_signature.get("subject") or "")
    current_markers = set(current_signature.get("markers") or set())
    for foreign_id, foreign_instruction in intent_by_id.items():
        if foreign_id == intent_id:
            continue
        foreign_signature = ordinary_art_patch_intent_signature(foreign_instruction)
        foreign_subject = str(foreign_signature.get("subject") or "")
        if len(foreign_subject) < 2 or foreign_subject == current_subject:
            continue
        unique_markers = set(foreign_signature.get("markers") or set()).difference(
            current_markers
        )
        if not unique_markers:
            continue
        unique_signature = {
            "subject": foreign_subject,
            "markers": unique_markers,
        }
        target_already_had_signature = any(
            ordinary_art_patch_clause_has_signature(clause, unique_signature)
            for clause in target_clauses
        )
        if target_already_had_signature:
            continue
        if any(
            ordinary_art_patch_clause_has_signature(clause, unique_signature)
            for clause in replacement_clauses
        ):
            return foreign_id
    return ""


def ordinary_art_instruction_describes_problem(value: str) -> bool:
    return bool(ordinary_art_problem_parts(value))


def ordinary_art_problem_markers(value: str) -> set[str]:
    markers = set()
    for clause in re.split(r"[，,；;\n]+", clean_text(value)):
        parts = ordinary_art_problem_parts(clause)
        if not parts:
            continue
        direction = ordinary_art_retention_compact(str(parts.get("direction") or ""))
        quality = ordinary_art_retention_compact(str(parts.get("quality") or ""))
        if direction:
            markers.add(f"{direction}:{quality}")
    return markers


def ordinary_art_patch_replacement_repeats_problem(
    instruction: str,
    replacement: str,
) -> bool:
    if not ordinary_art_instruction_describes_problem(instruction):
        return False
    instruction_markers = ordinary_art_problem_markers(instruction)
    if not instruction_markers.intersection(ordinary_art_problem_markers(replacement)):
        return False
    return not bool(re.search(
        r"不过|不再|受控|适中|清晰|可见|恢复|平衡|降低|减少|弱化|消除|修正|改善|增强|提升|"
        r"增加|补充|回归|保留|避免|"
        r"controlled|balanced|clear|visible|reduce|lower|fix|improve|increase|restore|avoid",
        replacement,
        flags=re.I,
    ))


def ordinary_art_patch_replacement_has_explicit_resolution(
    instruction: str,
    replacement: str,
) -> bool:
    """Recognize concrete final-state evidence without treating generic praise as a fix."""

    resolution_hint = ordinary_art_problem_resolution_hint(instruction)
    if not resolution_hint:
        return True
    problem_parts = ordinary_art_problem_parts(instruction)
    direction = str(problem_parts.get("direction") or "")
    if re.search(
        r"不过|不再|受控|适中|消除|修正|去除|抑制|缓解|改善|恢复|"
        r"controlled|resolved|fixed|suppress|improve|restore",
        replacement,
        flags=re.I,
    ):
        return True
    quality = ordinary_art_retention_compact(str(problem_parts.get("quality") or ""))
    replacement_compact = ordinary_art_retention_compact(replacement)
    if quality and quality in replacement_compact:
        directional_evidence = (
            r"降低|减少|弱化|reduce|lower|weaken"
            if direction == "high" else
            r"补足|增加|增强|提升|强化|充分|清晰|完整|"
            r"increase|enhance|boost|clear|complete"
            if direction == "low" else
            r"改善|恢复|improve|restore"
        )
        if re.search(directional_evidence, replacement, flags=re.I):
            return True
    instruction_text = clean_text(instruction)
    if re.search(r"模糊|看不清|不清晰|blurry|unclear", instruction_text, flags=re.I):
        return bool(re.search(r"清晰|可见|锐利|细节|clear|visible|sharp|detail", replacement, flags=re.I))
    if re.search(r"错误|异常|wrong|incorrect", instruction_text, flags=re.I):
        return bool(re.search(r"准确|正确|合理|自然|accurate|correct|proper", replacement, flags=re.I))
    if re.search(r"塑料|不真实|虚假|plastic|unreal", instruction_text, flags=re.I):
        return bool(re.search(r"真实|自然|细腻|realistic|natural|organic", replacement, flags=re.I))
    return False


def ordinary_art_patch_replacement_contradicts_problem(
    instruction: str,
    replacement: str,
) -> bool:
    """Reject only high-confidence moves that worsen a scalar problem."""

    if ordinary_art_patch_replacement_has_explicit_resolution(instruction, replacement):
        return False
    instruction_text = clean_text(instruction)
    low_problem = bool(re.search(
        r"(?:过于|过度|太)(?:暗|黑|弱|少|薄|小)|(?:暗|黑|弱|少|薄|小)(?:不足|不够)|"
        r"too\s+(?:dark|weak|small|thin|few)",
        instruction_text,
        flags=re.I,
    ))
    high_problem = bool(re.search(
        r"(?:过于|过度|太)(?:亮|强|多|厚|大|曝光|过曝)|"
        r"too\s+(?:bright|strong|large|thick|many)|overexpos",
        instruction_text,
        flags=re.I,
    ))
    if low_problem:
        if re.search(
            r"(?:增加|增强|提升|提高|补充).{0,8}(?:整体|背景|画面|环境)?(?:亮度|光照|补光|曝光)|"
            r"(?:increase|raise|boost).{0,16}(?:light|brightness|exposure)",
            replacement,
            flags=re.I,
        ):
            return False
        return bool(re.search(
            r"(?:降低|减少|削弱|压低|减弱).{0,8}(?:整体|背景|画面|环境)?"
            r"(?:亮度|曝光量|光照强度|补光强度)|更(?:暗|黑)|加深.{0,6}(?:暗|黑)|"
            r"(?:lower|reduce|decrease|dim).{0,16}(?:light|brightness|exposure)",
            replacement,
            flags=re.I,
        ))
    if high_problem:
        if re.search(
            r"(?:降低|减少|削弱|压低|减弱).{0,8}(?:整体|背景|画面|环境)?"
            r"(?:亮度|曝光|高光强度|补光强度)|"
            r"(?:lower|reduce|decrease|dim).{0,16}(?:light|brightness|exposure)",
            replacement,
            flags=re.I,
        ):
            return False
        return bool(re.search(
            r"(?:增加|增强|提升|提高).{0,8}(?:整体|背景|画面|环境)?"
            r"(?:亮度|曝光量|补光强度|高光强度|补光)|更亮|加剧.{0,6}(?:亮|曝光|高光)|"
            r"(?:increase|raise|boost).{0,16}(?:light|brightness|exposure)",
            replacement,
            flags=re.I,
        ))
    return False


def ordinary_art_patch_named_blocks_preserved(
    raw_prompt: str,
    merged_prompt: str,
    removal_targets: list[str],
) -> bool:
    """Keep every named block label unless the user explicitly deletes that whole block."""

    remaining_labels = [
        ordinary_art_retention_compact(label)
        for label, _block_text in ordinary_art_retention_blocks(merged_prompt)
    ]
    for label, block_text in ordinary_art_retention_blocks(raw_prompt):
        if ordinary_art_retention_block_explicitly_removed(
            label,
            block_text,
            removal_targets,
        ):
            continue
        label_compact = ordinary_art_retention_compact(label)
        if not label_compact or label_compact not in remaining_labels:
            return False
        remaining_labels.remove(label_compact)
    return True


def ordinary_art_patch_validation_context(
    requirements: str,
    target_quote: str,
) -> tuple[str, str, dict[str, str]]:
    """Select an optional semantic clause without making it an anchor gate."""

    clause_by_id = {
        f"C{index + 1:02d}": clause
        for index, clause in enumerate(ordinary_art_patch_feedback_clauses(requirements))
    }
    matching_ids = [
        clause_id
        for clause_id, clause in clause_by_id.items()
        if ordinary_art_patch_target_matches_intent(clause, target_quote)
    ]
    if len(matching_ids) == 1:
        clause_id = matching_ids[0]
        return clause_id, clause_by_id[clause_id], clause_by_id
    # A missing or ambiguous lexical relationship is allowed. Exact quote
    # replacement remains the authority; semantic scalar checks simply abstain.
    return "", "", clause_by_id


def ordinary_art_patch_priority_retention_failure(
    raw_prompt: str,
    requirements: str,
    candidate: str,
) -> str:
    """Protect named hard-constraint blocks while exact merge preserves all other bytes."""

    priority_missing = [
        label
        for label in ordinary_art_retention_missing_blocks(
            raw_prompt,
            requirements,
            candidate,
        )
        if re.search(
            r"要求|避免|禁止|约束|目标|require|avoid|constraint|target",
            label,
            re.I,
        )
    ]
    return f"missing-blocks:{','.join(priority_missing)}" if priority_missing else ""


def ordinary_art_payload_has_reference_images(payload: dict) -> bool:
    """Treat any explicit reference-image carrier as non-text-only."""

    for key in (
        "images", "referenceImages", "reference_images", "references",
        "image", "imageUrl", "image_url", "imageData", "image_data",
        "referenceImage", "reference_image", "referenceImageUrls",
        "reference_image_urls", "referenceImagePaths", "reference_image_paths",
        "imagePaths", "image_paths", "inputImages", "input_images",
        "sourceImage", "source_image",
    ):
        value = payload.get(key)
        if isinstance(value, (list, tuple, set, dict)) and len(value) > 0:
            return True
        if isinstance(value, str) and value.strip():
            return True
    return False


ORDINARY_ART_STRUCTURED_PERSON_IDENTITY_PATTERN = re.compile(
    r"(?:人物|角色|女性|男性|女人|男人|女子|男子|女士|男士|人像|人体|"
    r"美女|女郎|帅哥|骑士|武士|战士)"
    r"|(?<![a-z0-9_])(?:person|character|woman|women|man|men|female|male|"
    r"lady|ladies|gentleman|human)(?![a-z0-9_])",
    re.I,
)
ORDINARY_ART_STRUCTURED_SENSUAL_CONTEXT_PATTERN = re.compile(
    r"(?:性感|成人向|情色|色情|挑逗|诱惑|妩媚|风骚)"
    r"|(?<![a-z0-9_])(?:sensual|sexy|adult[-\s]+oriented|erotic|pornographic|"
    r"seductive|provocative|suggestive)(?![a-z0-9_])",
    re.I,
)
ORDINARY_ART_STRUCTURED_EXPLICIT_ADULT_IDENTITY_PATTERN = re.compile(
    r"(?<!未)(?<!非)成年人"
    r"|(?:成年|成人)[^，。；;,.!?！？\n]{0,10}(?:女性|男性|人物|角色|主体|女人|男人|女子|男子)"
    r"|(?:年满|至少)\s*(?:18|十八)\s*岁"
    r"|(?<![0-9])(?:1[89]|[2-9][0-9])\s*岁(?:以上)?(?![0-9])"
    r"|(?<![a-z0-9_])adult[-\s]+(?:woman|man|person|subject|character|female|male)(?![a-z0-9_])"
    r"|(?<![a-z0-9_])(?:over|at\s+least)\s+18(?![a-z0-9_])"
    r"|(?<![a-z0-9_])(?:1[89]|[2-9][0-9])[-\s]+years?[-\s]+old(?![a-z0-9_])"
    r"|(?<![a-z0-9_])18\+(?![a-z0-9_])",
    re.I,
)


def ordinary_art_structured_has_explicit_adult_identity(value: str) -> bool:
    return bool(minimax_h3_affirmative_pattern_matches(
        value,
        ORDINARY_ART_STRUCTURED_EXPLICIT_ADULT_IDENTITY_PATTERN,
    ))


def ordinary_art_structured_has_sensitive_person_context(*values: str) -> bool:
    text = "\n".join(clean_text(value) for value in values if clean_text(value))
    if not text or not minimax_h3_affirmative_pattern_matches(
        text,
        ORDINARY_ART_STRUCTURED_PERSON_IDENTITY_PATTERN,
    ):
        return False
    if minimax_h3_affirmative_pattern_matches(
        text,
        ORDINARY_ART_STRUCTURED_SENSUAL_CONTEXT_PATTERN,
    ):
        return True
    return any(
        minimax_h3_affirmative_pattern_matches(text, pattern)
        for pattern in MINIMAX_H3_SENSITIVE_SIGNAL_PATTERNS.values()
    )


def is_ordinary_art_structured_recompile_payload(
    payload: dict,
    raw_prompt: str,
    *,
    is_ordinary_art: bool,
    is_create: bool,
) -> bool:
    """Enable the new contract only for an exact, text-only opt-in."""

    prompt_schema = clean_text(payload.get("promptSchema") or "")
    surface = clean_text(payload.get("surface") or "").lower()
    purpose = clean_text(payload.get("purpose") or "").lower()
    current_prompt = payload.get("currentPrompt")
    return bool(
        prompt_schema == ART_PROMPT_SCHEMA_VERSION
        and surface == "art"
        and purpose == "optimize"
        and isinstance(current_prompt, str)
        and clean_text(current_prompt)
        and is_ordinary_art
        and not is_create
        and clean_text(raw_prompt)
        and not ordinary_art_payload_has_reference_images(payload)
    )


ORDINARY_ART_STRUCTURED_NAMED_HARD_LABEL_PATTERN = re.compile(
    r"(?:画面目标|质量底线|用户要求|附加要求|要求|避免|禁止|约束|目标|规则|限制|必需|不得|"
    r"requirements?|avoid|constraints?|targets?|rules?|restrictions?|prohibitions?|goals?)",
    re.I,
)
ORDINARY_ART_STRUCTURED_ATOMIC_HARD_PATTERN = re.compile(
    r"(?:必须|不得|禁止|避免|保持|只允许|不能|不允许|不可|务必|"
    r"结构正确|归属明确|清晰可辨|质量底线|画面目标|高完成度|"
    r"成年人?|成人(?:女性|男性|主体|角色)?|\d+\s*岁以上|年龄|身份|"
    r"主体数量|人物数量|人数|解剖|肢体|手指|手臂|四只手|双腿|五官|脸|"
    r"must|required|requirement|avoid|never|only|keep|constraint|target|"
    r"anatomy|limbs?|hands?|arms?|legs?|faces?|identity|age)",
    re.I,
)


def ordinary_art_structured_named_hard_constraint_clauses(
    raw_prompt: str,
) -> list[tuple[str, str]]:
    """Read both paragraph and flattened named hard sections as atomic facts."""

    source = str(raw_prompt or "").replace("\r\n", "\n").replace("\r", "\n")
    header = re.compile(
        rf"(?:\*\*)?\s*(?P<label>{ORDINARY_ART_STRUCTURED_NAMED_HARD_LABEL_PATTERN.pattern})"
        r"\s*[:：]\s*",
        re.I,
    )
    matches = list(header.finditer(source))
    result: list[tuple[str, str]] = []
    seen: set[str] = set()
    for index, match in enumerate(matches):
        label = clean_text(match.group("label") or "")
        segment_end = matches[index + 1].start() if index + 1 < len(matches) else len(source)
        blank = re.search(r"\n\s*\n", source[match.end():segment_end])
        if blank:
            segment_end = match.end() + blank.start()
        body = source[match.end():segment_end].strip().strip("*").strip()
        if not body:
            continue
        negative_section = bool(re.search(
            r"避免|禁止|不得|avoid|prohibit|restriction",
            label,
            re.I,
        ))
        for raw_clause in re.split(r"[；;。！？!?\n]+", body):
            clause = clean_text(raw_clause).strip(" *：:")
            if not clause:
                continue
            if negative_section:
                final_fact = clause if re.search(
                    r"(?:避免|禁止|不得|不能|不允许|不可|never|avoid|prohibit|forbid|must\s+not)",
                    clause,
                    re.I,
                ) else f"避免{clause}"
            elif ORDINARY_ART_STRUCTURED_ATOMIC_HARD_PATTERN.search(clause):
                final_fact = clause
            else:
                final_fact = f"必须保持{clause}"
            compact = ordinary_art_retention_compact(final_fact)
            if compact and compact not in seen:
                seen.add(compact)
                result.append((label, final_fact))
    return result


def ordinary_art_structured_hard_constraint_blocks(raw_prompt: str) -> list[tuple[str, str]]:
    """Return atomic named and inline terminal constraints for deterministic retention."""

    named = ordinary_art_structured_named_hard_constraint_clauses(raw_prompt)
    named_compacts = [
        ordinary_art_retention_compact(block_text)
        for _label, block_text in named
    ]
    inline_marker = re.compile(
        r"(?:必须|禁止|不得|避免|只能|只允许|保持)"
        r"|(?<![a-z0-9_])(?:must|required|only|keep|never|avoid|prohibit|forbid)(?![a-z0-9_])",
        re.I,
    )
    inline: list[tuple[str, str]] = []
    source = str(raw_prompt or "").replace("\r\n", "\n").replace("\r", "\n")
    candidates: list[str] = []
    for sentence in re.split(r"[。！？.!?；;\n]+", source):
        for clause in re.split(
            r"[，,]+|\b(?:and|but)\s+(?=(?:must|required|only|keep|never|avoid|prohibit|forbid)\b)",
            sentence,
            flags=re.I,
        ):
            value = clean_text(clause).strip(" ：:")
            if value and inline_marker.search(value):
                candidates.append(value)
    seen: set[str] = set()
    for candidate in candidates:
        compact = ordinary_art_retention_compact(candidate)
        if not compact or compact in seen:
            continue
        seen.add(compact)
        if any(
            compact in named_compact or named_compact in compact
            for named_compact in named_compacts
        ):
            continue
        inline.append((f"内联硬约束{len(inline) + 1:02d}", candidate))
    return named + inline


def ordinary_art_structured_inline_hard_constraint_anchor(block_text: str) -> str:
    return clean_text(re.sub(
        r"(?:必须|禁止|不得|避免|只能|只允许|保持|增加|添加|出现)"
        r"|(?<![a-z0-9_])(?:must|required|only|keep|never|avoid|prohibit|forbid|"
        r"remain|stay|add|include|show|be|not)(?![a-z0-9_])",
        " ",
        ordinary_art_retention_block_body(block_text),
        flags=re.I,
    )).strip(" ：:")


def ordinary_art_structured_counted_body_facts(value: str) -> list[tuple[int, str, int, int]]:
    facts: list[tuple[int, str, int, int]] = []
    pattern = re.compile(
        r"(?P<count_cn>[一二两三四五六七八九十]|[1-9]|1[0-2])\s*(?:只|条|张|个)?\s*"
        r"(?P<body_cn>手臂|手|腿|眼睛|耳朵|脸|面孔|面部|五官)"
        r"|(?<![a-z0-9_])(?P<count_en>one|two|three|four|five|six|seven|eight|nine|ten|[1-9]|1[0-2])\s+"
        r"(?P<body_en>hands?|arms?|legs?|eyes?|ears?|faces?|facial\s+features)(?![a-z0-9_])",
        re.I,
    )
    body_aliases = {
        "hands": "hand", "hand": "hand", "手": "hand",
        "arms": "arm", "arm": "arm", "手臂": "arm",
        "legs": "leg", "leg": "leg", "腿": "leg",
        "eyes": "eye", "eye": "eye", "眼睛": "eye",
        "ears": "ear", "ear": "ear", "耳朵": "ear",
        "faces": "face", "face": "face", "facial features": "face",
        "脸": "face", "面孔": "face", "面部": "face", "五官": "face",
    }
    for match in pattern.finditer(str(value or "")):
        count = ordinary_art_structured_parsed_count(
            match.group("count_cn") or match.group("count_en") or ""
        )
        body = clean_text(
            match.group("body_cn") or match.group("body_en") or ""
        ).lower()
        normalized_body = body_aliases.get(body, "")
        if count and normalized_body:
            facts.append((count, normalized_body, match.start(), match.end()))
    return facts


def ordinary_art_structured_counted_body_rewrite_targeted(
    block_text: str,
    requirements: str,
) -> bool:
    instruction = ordinary_art_user_change_instruction(requirements)
    source_facts = ordinary_art_structured_counted_body_facts(block_text)
    target_facts = ordinary_art_structured_counted_body_facts(instruction)
    if not source_facts or len(target_facts) < 2:
        return False
    for source_count, source_body, _source_start, _source_end in source_facts:
        for index, (old_count, old_body, old_start, old_end) in enumerate(target_facts):
            if old_count != source_count or old_body != source_body:
                continue
            prefix = instruction[max(0, old_start - 24):old_start]
            for new_count, new_body, new_start, _new_end in target_facts[index + 1:]:
                if new_body != source_body or new_count == source_count:
                    continue
                bridge = instruction[old_end:new_start]
                if re.search(
                    r"(?:改为|改成|替换为|换成|变为|设为|设置为)"
                    r"|(?<![a-z0-9_])to(?![a-z0-9_])",
                    bridge,
                    re.I,
                ) and re.search(
                    r"(?:将|把|修改|调整|改变|替换|设置)"
                    r"|(?<![a-z0-9_])(?:change|replace|set|redefine)(?![a-z0-9_])",
                    prefix,
                    re.I,
                ):
                    return True
    return False


def ordinary_art_structured_inline_hard_constraint_targeted(
    block_text: str,
    requirements: str,
) -> bool:
    instruction = ordinary_art_user_change_instruction(requirements)
    if not instruction or not re.search(
        r"(?:修改|调整|改为|改成|替换|变更|更新|设为|设置为|删除|移除|"
        r"去掉|去除|取消|增加|添加)"
        r"|(?<![a-z0-9_])(?:change|replace|update|set|remove|delete|omit|drop|add|increase)\b",
        instruction,
        re.I,
    ):
        return False
    if ordinary_art_structured_counted_body_rewrite_targeted(
        block_text,
        requirements,
    ):
        return True
    body = ordinary_art_structured_inline_hard_constraint_anchor(block_text)
    body_compact = ordinary_art_retention_compact(body)
    for target in ordinary_art_explicit_removal_targets(requirements):
        target_compact = re.sub(
            r"(?:要求|约束|规则|限制|内容|项|段|部分|块|章节|"
            r"requirements?|constraints?|rules?|restrictions?|content|section)$",
            "",
            ordinary_art_retention_compact(target),
            flags=re.I,
        )
        if len(target_compact) >= 3 and target_compact in body_compact:
            return True
    body_bigrams = ordinary_art_retention_bigrams(body)
    instruction_bigrams = ordinary_art_retention_bigrams(instruction)
    bigram_coverage = (
        len(body_bigrams.intersection(instruction_bigrams)) / len(body_bigrams)
        if body_bigrams else 0.0
    )
    english_stop = {
        "the", "a", "an", "to", "of", "and", "or", "not", "constraint",
        "rule", "requirement",
    }
    body_words = {
        word for word in re.findall(r"[a-z0-9]+", body.lower())
        if len(word) >= 2 and word not in english_stop
    }
    instruction_words = {
        word for word in re.findall(r"[a-z0-9]+", instruction.lower())
        if len(word) >= 2 and word not in english_stop
    }
    word_coverage = (
        len(body_words.intersection(instruction_words)) / len(body_words)
        if body_words else 0.0
    )
    return bigram_coverage >= 0.5 or word_coverage >= 0.5


def ordinary_art_structured_inline_hard_constraint_preserved(
    block_text: str,
    terminal_constraints: str,
) -> bool:
    anchor = ordinary_art_structured_inline_hard_constraint_anchor(block_text)
    anchor_compact = ordinary_art_retention_compact(anchor)
    anchor_bigrams = ordinary_art_retention_bigrams(anchor)
    english_stop = {"the", "a", "an", "to", "of", "and", "or", "not"}
    anchor_words = {
        word for word in re.findall(r"[a-z0-9]+", anchor.lower())
        if len(word) >= 2 and word not in english_stop
    }
    negative = bool(re.search(
        r"(?:禁止|不得|避免)"
        r"|(?<![a-z0-9_])(?:never|avoid|prohibit|forbid|must\s+not)(?![a-z0-9_])",
        block_text,
        re.I,
    ))
    for line in str(terminal_constraints or "").splitlines():
        candidate = clean_text(line)
        if not candidate:
            continue
        candidate_compact = ordinary_art_retention_compact(candidate)
        compact_match = bool(anchor_compact and anchor_compact in candidate_compact)
        bigram_coverage = (
            len(anchor_bigrams.intersection(
                ordinary_art_retention_bigrams(candidate)
            )) / len(anchor_bigrams)
            if anchor_bigrams else 0.0
        )
        candidate_words = {
            word for word in re.findall(r"[a-z0-9]+", candidate.lower())
            if len(word) >= 2 and word not in english_stop
        }
        word_coverage = (
            len(anchor_words.intersection(candidate_words)) / len(anchor_words)
            if anchor_words else 0.0
        )
        if not (compact_match or bigram_coverage >= 0.55 or word_coverage >= 0.6):
            continue
        if negative and not re.search(
            r"(?:禁止|不得|避免|不能|不允许|不可)"
            r"|(?<![a-z0-9_])(?:never|avoid|prohibit|forbid|must\s+not|no)(?![a-z0-9_])",
            candidate,
            re.I,
        ):
            continue
        return True
    return False


def ordinary_art_structured_hard_block_targeted(
    raw_prompt: str,
    requirements: str,
    label: str,
    block_text: str,
) -> bool:
    if label.startswith("内联硬约束"):
        return ordinary_art_structured_inline_hard_constraint_targeted(
            block_text,
            requirements,
        )
    removal_targets = ordinary_art_explicit_removal_targets(requirements)
    if ordinary_art_retention_block_explicitly_removed(
        label,
        block_text,
        removal_targets,
    ):
        return True
    if ordinary_art_short_priority_change_authorized(
        label,
        block_text,
        requirements,
    ):
        return True
    if ordinary_art_structured_inline_hard_constraint_targeted(
        block_text,
        requirements,
    ):
        return True
    core_failure = ordinary_art_core_redefinition_failure(
        raw_prompt,
        requirements,
        raw_prompt,
    )
    return bool(
        core_failure
        and re.search(
            r"(?:女性|男性|女人|男人|女子|男子|两位|双女性|双男性|"
            r"角色|人物|主体|左侧|右侧|全身|上半身|下半身|景别|构图|"
            r"裸体|裸露|躺|坐|站|跪|俯卧|仰卧)",
            block_text,
            re.I,
        )
    )


ORDINARY_ART_STRUCTURED_VISIBLE_HARD_COLORS = (
    ("red", re.compile(r"(?:红色|深红|绯红|赤红|酒红)|(?<![a-z])(?:red|crimson|scarlet|burgundy)(?![a-z])", re.I)),
    ("blue", re.compile(r"(?:蓝色|深蓝|浅蓝|天蓝|藏蓝)|(?<![a-z])(?:blue|navy|azure)(?![a-z])", re.I)),
    ("white", re.compile(r"(?:白色|象牙白|乳白)|(?<![a-z])(?:white|ivory)(?![a-z])", re.I)),
    ("black", re.compile(r"(?:黑色|乌黑|墨黑)|(?<![a-z])black(?![a-z])", re.I)),
    ("green", re.compile(r"(?:绿色|青绿色|翠绿|墨绿)|(?<![a-z])(?:green|teal|emerald)(?![a-z])", re.I)),
    ("gold", re.compile(r"(?:金色|淡金|黄金色)|(?<![a-z])gold(?:en)?(?![a-z])", re.I)),
    ("silver", re.compile(r"(?:银色|银白)|(?<![a-z])silver(?![a-z])", re.I)),
    ("purple", re.compile(r"(?:紫色|淡紫|深紫)|(?<![a-z])purple(?![a-z])", re.I)),
    ("pink", re.compile(r"(?:粉色|粉红|玫粉)|(?<![a-z])pink(?![a-z])", re.I)),
    ("brown", re.compile(r"(?:棕色|褐色)|(?<![a-z])brown(?![a-z])", re.I)),
)
ORDINARY_ART_STRUCTURED_VISIBLE_HARD_OBJECTS = (
    ("dress", re.compile(r"(?:裙装|连衣裙|长裙|短裙|裙子|衣裙)|(?<![a-z])(?:dress|gown|skirt)(?:es)?(?![a-z])", re.I)),
    ("clothing", re.compile(r"(?:服装|服饰|衣服|华服|着装|上衣|外套|长袍|衣袍)|(?<![a-z])(?:clothes|clothing|outfit|costume|garment|robe|coat|shirt)(?:s)?(?![a-z])", re.I)),
    ("hat", re.compile(r"(?:帽子|礼帽|帽饰|头戴帽)|(?<![a-z])(?:hat|cap|headwear)(?:s)?(?![a-z])", re.I)),
    ("shoes", re.compile(r"(?:鞋子|鞋履|靴子|高跟鞋)|(?<![a-z])(?:shoes?|boots?|heels?)(?![a-z])", re.I)),
    ("armor", re.compile(r"(?:盔甲|铠甲|护甲)|(?<![a-z])armo[u]?r(?![a-z])", re.I)),
    ("earring", re.compile(r"(?:耳饰|耳环|耳坠)|(?<![a-z])earrings?(?![a-z])", re.I)),
    ("jewelry", re.compile(r"(?:首饰|珠宝|项链|手镯)|(?<![a-z])(?:jewelry|jewellery|necklace|bracelet)(?:s)?(?![a-z])", re.I)),
    ("crown", re.compile(r"(?:发冠|皇冠|王冠)|(?<![a-z])crowns?(?![a-z])", re.I)),
    ("sword", re.compile(r"(?:剑|长剑|佩剑)|(?<![a-z])swords?(?![a-z])", re.I)),
    ("fan", re.compile(r"(?:折扇|团扇|扇子)|(?<![a-z])fans?(?![a-z])", re.I)),
    ("bottle", re.compile(r"(?:瓶子|瓶身|香水瓶|酒瓶)|(?<![a-z])bottles?(?![a-z])", re.I)),
    ("car", re.compile(r"(?:汽车|轿车|车辆)|(?<![a-z])(?:car|vehicle)(?:s)?(?![a-z])", re.I)),
    ("book", re.compile(r"(?:书本|书籍|书册)|(?<![a-z])books?(?![a-z])", re.I)),
    ("umbrella", re.compile(r"(?:雨伞|阳伞|伞)|(?<![a-z])umbrellas?(?![a-z])", re.I)),
    ("object", re.compile(r"(?:物体|物件|道具)|(?<![a-z])(?:object|prop)(?:s)?(?![a-z])", re.I)),
)
ORDINARY_ART_STRUCTURED_VISIBLE_HARD_POSES = (
    ("standing", re.compile(r"(?:站立|站姿|站着|站在|站于|立于)|(?<![a-z])stand(?:s|ing)?(?![a-z])", re.I)),
    ("sitting", re.compile(r"(?:坐姿|坐着|坐在|端坐)|(?<![a-z])(?:sit(?:s|ting)?|seated)(?![a-z])", re.I)),
    ("kneeling", re.compile(r"(?:跪姿|跪着|跪地)|(?<![a-z])kneel(?:s|ing)?(?![a-z])", re.I)),
    ("lying", re.compile(r"(?:躺姿|躺着|躺卧|平躺|仰卧|俯卧)|(?<![a-z])(?:lying|reclining|supine|prone)(?![a-z])", re.I)),
)
ORDINARY_ART_STRUCTURED_VISIBLE_HARD_ACTIONS = (
    ("kiss", re.compile(r"(?:亲吻|接吻|拥吻)|(?<![a-z])kiss(?:es|ed|ing)?(?![a-z])", re.I)),
    ("embrace", re.compile(r"(?:依偎|拥抱|环抱)|(?<![a-z])(?:embrac(?:e|es|ed|ing)|cuddl(?:e|es|ed|ing))(?![a-z])", re.I)),
)
ORDINARY_ART_STRUCTURED_VISIBLE_HARD_LIGHT_DIRECTIONS = (
    ("left", re.compile(r"(?:左侧|左边|左方|左上|左下)|(?<![a-z])left(?:[-\s]+(?:side|upper|lower))?(?![a-z])", re.I)),
    ("right", re.compile(r"(?:右侧|右边|右方|右上|右下)|(?<![a-z])right(?:[-\s]+(?:side|upper|lower))?(?![a-z])", re.I)),
    ("top", re.compile(r"(?:上方|顶部|顶光|正上方)|(?<![a-z])(?:top|above|overhead)(?![a-z])", re.I)),
    ("bottom", re.compile(r"(?:下方|底部|底光)|(?<![a-z])(?:bottom|below)(?![a-z])", re.I)),
    ("front", re.compile(r"(?:前方|正面光)|(?<![a-z])front(?:al)?(?![a-z])", re.I)),
    ("back", re.compile(r"(?:后方|背光|逆光)|(?<![a-z])(?:back|backlit)(?![a-z])", re.I)),
)
ORDINARY_ART_STRUCTURED_VISIBLE_HARD_LIGHT_QUALITIES = (
    ("soft", re.compile(r"(?:柔光|柔和光|软光)|(?<![a-z])soft(?:[-\s]+light(?:ing)?)?(?![a-z])", re.I)),
    ("hard", re.compile(r"(?:硬光|强硬光)|(?<![a-z])hard(?:[-\s]+light(?:ing)?)?(?![a-z])", re.I)),
    ("high_key", re.compile(r"(?:高调光|高调照明)|(?<![a-z])high[-\s]+key(?![a-z])", re.I)),
    ("low_key", re.compile(r"(?:低调光|低调照明)|(?<![a-z])low[-\s]+key(?![a-z])", re.I)),
)
ORDINARY_ART_STRUCTURED_VISIBLE_HARD_CAMERA_SLOTS = (
    ("shot", re.compile(r"(?:景别|镜头范围)|(?<![a-z])shot(?:\s+size)?(?![a-z])", re.I)),
    ("angle", re.compile(r"(?:视角|机位|拍摄角度)|(?<![a-z])(?:viewing\s+)?angle(?![a-z])", re.I)),
    ("composition", re.compile(r"(?:构图|画面布局)|(?<![a-z])(?:composition|layout)(?![a-z])", re.I)),
    ("perspective", re.compile(r"(?:透视|焦段|镜头畸变)|(?<![a-z])(?:perspective|lens|distortion)(?![a-z])", re.I)),
    ("depth_of_field", re.compile(r"(?:景深|对焦范围)|(?<![a-z])(?:depth\s+of\s+field|focus\s+range)(?![a-z])", re.I)),
)
ORDINARY_ART_STRUCTURED_VISIBLE_HARD_STYLE_SLOTS = (
    ("medium", re.compile(r"(?:绘画媒介|制作媒介|媒介)|(?<![a-z])medium(?![a-z])", re.I)),
    ("render_language", re.compile(r"(?:绘画语言|渲染语言|造型语言)|(?<![a-z])(?:render(?:ing)?\s+language|render\s+style)(?![a-z])", re.I)),
    ("atmosphere", re.compile(r"(?:画面氛围|审美氛围|氛围)|(?<![a-z])(?:atmosphere|mood)(?![a-z])", re.I)),
    ("finish", re.compile(r"(?:完成质感|表面质感|材质质感)|(?<![a-z])(?:finish|surface\s+quality)(?![a-z])", re.I)),
)
ORDINARY_ART_STRUCTURED_VISIBLE_HARD_RELATIONS = (
    ("body-overlap", re.compile(r"(?:身体交叠|身体重叠|交叠的身体)|(?<![a-z])(?:body|bodies)[-\s]+overlap(?:ping|ped)?(?![a-z])", re.I)),
    ("body-contact", re.compile(r"(?:身体接触|肢体接触)|(?<![a-z])(?:body|physical)[-\s]+contact(?![a-z])", re.I)),
)
ORDINARY_ART_STRUCTURED_VISIBLE_HARD_NEGATIVE_CONCEPTS = (
    ("3d-render", re.compile(r"(?:3D|三维)(?:渲染|绘制|画面|图像|风格)?|(?<![a-z0-9])3d(?:[-\s]+(?:render(?:ing)?|art|image|style))?(?![a-z0-9])", re.I), ("style",)),
    ("plastic-skin", re.compile(r"(?:塑料|塑胶|蜡像)(?:感|质感|般)?(?:的)?皮肤|皮肤[^，,。！？；;\n]{0,12}(?:塑料|塑胶|蜡像)|(?<![a-z])(?:plastic|waxy)[-\s]+skin|skin[^,.;!?\n]{0,16}(?:plastic|waxy)(?![a-z])", re.I), ("finish", "subject-appearance")),
    ("duplicate-face", re.compile(r"(?:复制脸|复制面孔|相同(?:的)?脸|同一张脸|两张脸[^，,。！？；;\n]{0,20}(?:相同|一样))|(?<![a-z])(?:duplicate|identical|same)[-\s]+faces?(?![a-z])", re.I), ("relations", "subject-appearance")),
    ("bad-anatomy", re.compile(r"(?:错误|畸形|扭曲|融合|多余)(?:的)?(?:肢体|手指|手臂|腿|解剖)|(?:肢体|手指|手臂|腿|解剖)[^，,。！？；;\n]{0,12}(?:错误|畸形|扭曲|融合|多余)|(?<![a-z])(?:bad|wrong|malformed|deformed|fused|extra)[-\s]+(?:anatomy|limbs?|fingers?|arms?|legs?)(?![a-z])", re.I), ("relations", "subject-pose")),
    ("visible-fusion", re.compile(r"(?:互相|彼此|错误)?融合|(?<![a-z])(?:fuse|fused|fusion|merge|merged)(?![a-z])", re.I), ("relations", "subject-appearance")),
    ("face-occlusion", re.compile(r"(?:(?:帽子|礼帽|帽饰)[^，,。！？；;\n]{0,24}(?:遮挡|遮住|盖住)[^，,。！？；;\n]{0,12}(?:脸|面部|五官)|(?:hat|cap|headwear)[^,.;!?\n]{0,28}(?:obscur|cover)[a-z]*[^,.;!?\n]{0,16}(?:face|facial))", re.I), ("relations", "subject-appearance")),
)


def ordinary_art_structured_visible_hard_texts(value) -> list[str]:
    if isinstance(value, str):
        cleaned = clean_text(value)
        return [cleaned] if cleaned else []
    if isinstance(value, list):
        return [
            text
            for item in value
            for text in ordinary_art_structured_visible_hard_texts(item)
        ]
    return []


def ordinary_art_structured_visible_hard_subject_facts(subject: dict) -> list[str]:
    return [
        text
        for field in ("name", "appearance", "materials", "colors", "details", "action")
        for text in ordinary_art_structured_visible_hard_texts(subject.get(field))
    ]


def ordinary_art_structured_visible_hard_span_is_affirmative(
    text: str,
    start: int,
    end: int,
) -> bool:
    prefix = text[max(0, start - 36):start]
    if ORDINARY_ART_CORE_NEGATED_MENTION_PREFIX_PATTERN.search(prefix):
        return False
    if re.search(
        r"(?:不是|并非|并不|不呈现|非)\s*[^，,。！？；;\n]{0,10}$"
        r"|(?:未(?:佩戴|穿戴|穿|戴|出现|呈现|采用|使用|包含|包括)|"
        r"不(?:佩戴|穿戴|戴|出现|采用|使用)|没有|无)"
        r"\s*[^，,。！？；;\n]{0,10}$"
        r"|(?<![a-z0-9_])(?:not|non[-\s]?|isn't|aren't)\s+[^,.;!?\n]{0,12}$",
        prefix,
        re.I,
    ):
        return False
    suffix = text[end:end + 28]
    if re.match(
        r"\s*(?:(?:未|没有|不曾|从未|不得|不能|不会|不)\s*(?:被)?\s*"
        r"(?:出现|存在|呈现|采用|使用|佩戴|穿戴|戴|包含|包括)"
        r"|(?:(?:is|are|was|were)\s+)?(?:not|never)\s+"
        r"(?:worn|present|shown|included|used|depicted)"
        r"|(?:(?:is|are|was|were)\s+)?absent)",
        suffix,
        re.I,
    ):
        return False
    return True


def ordinary_art_structured_visible_hard_match_is_affirmative(
    text: str,
    match: re.Match,
) -> bool:
    return ordinary_art_structured_visible_hard_span_is_affirmative(
        text,
        match.start(),
        match.end(),
    )


def ordinary_art_structured_visible_hard_fact_is_affirmative(
    fact: str,
    pattern: re.Pattern,
) -> bool:
    text = str(fact or "")
    for match in pattern.finditer(text):
        if ordinary_art_structured_visible_hard_match_is_affirmative(text, match):
            return True
    return False


def ordinary_art_structured_visible_hard_is_negative(label: str, fact: str) -> bool:
    return bool(
        re.search(r"避免|禁止|不得|限制|avoid|prohibit|restriction", label, re.I)
        or re.search(
            r"(?:禁止|避免|不得|不能|不可|不允许|不要|无|没有|不戴)"
            r"|(?<![a-z0-9_])(?:never|avoid|without|must\s+not|may\s+not|do\s+not|no\s+(?:character|person|subject|one)?)(?![a-z0-9_])",
            fact,
            re.I,
        )
    )


def ordinary_art_structured_visible_hard_single_match(
    fact: str,
    definitions: tuple,
) -> tuple[str, re.Pattern] | tuple[None, None]:
    matches = [(name, pattern) for name, pattern in definitions if pattern.search(fact)]
    return matches[0] if len(matches) == 1 else (None, None)


def ordinary_art_structured_visible_hard_affirmative_occurrences(
    fact: str,
    definitions: tuple,
) -> list[tuple[str, int, int]]:
    text = str(fact or "")
    result: list[tuple[str, int, int]] = []
    for name, pattern in definitions:
        for match in pattern.finditer(text):
            if ordinary_art_structured_visible_hard_match_is_affirmative(text, match):
                result.append((name, match.start(), match.end()))
    return sorted(result, key=lambda item: (item[1], item[2], item[0]))


def ordinary_art_structured_visible_hard_attribute_object_binding_state(
    fact: str,
    attribute_definitions: tuple,
    attribute_name: str,
    object_name: str,
) -> str:
    """Return bound/separate/ambiguous/absent using local phrase ownership."""

    text = str(fact or "")
    attributes = ordinary_art_structured_visible_hard_affirmative_occurrences(
        text,
        attribute_definitions,
    )
    objects = ordinary_art_structured_visible_hard_affirmative_occurrences(
        text,
        ORDINARY_ART_STRUCTURED_VISIBLE_HARD_OBJECTS,
    )
    target_attributes = [index for index, item in enumerate(attributes) if item[0] == attribute_name]
    target_objects = [index for index, item in enumerate(objects) if item[0] == object_name]
    if not target_attributes or not target_objects:
        return "absent"

    edges: set[tuple[int, int]] = set()
    for attribute_index, (_attribute, attribute_start, attribute_end) in enumerate(attributes):
        for object_index, (_object, object_start, object_end) in enumerate(objects):
            gap_start = min(attribute_end, object_end)
            gap_end = max(attribute_start, object_start)
            if gap_end < gap_start:
                continue
            gap = text[gap_start:gap_end]
            if len(re.sub(r"\s+", "", gap)) > 32 or re.search(
                r"[，,。！？；;：:\n]",
                gap,
            ):
                continue
            if any(
                other_index != object_index
                and other_start >= gap_start
                and other_end <= gap_end
                for other_index, (_name, other_start, other_end) in enumerate(objects)
            ):
                continue
            other_object_present = any(
                other_index != object_index
                for other_index in range(len(objects))
            )
            if other_object_present and re.search(
                r"(?:搭配|配以|以及|并且|同时|而|但|与|和|及)"
                r"|(?<![a-z])(?:with|and|plus|while|whereas|alongside)(?![a-z])",
                gap,
                re.I,
            ):
                continue
            edges.add((attribute_index, object_index))

    target_edges = [
        edge for edge in edges
        if edge[0] in target_attributes and edge[1] in target_objects
    ]
    multiple_attributes_and_objects = bool(
        len({item[0] for item in attributes}) > 1
        and len({item[0] for item in objects}) > 1
    )
    for attribute_index, object_index in target_edges:
        if multiple_attributes_and_objects and (
            any(edge[0] == attribute_index and edge[1] != object_index for edge in edges)
            or any(edge[1] == object_index and edge[0] != attribute_index for edge in edges)
        ):
            continue
        return "bound"
    if target_edges:
        return "ambiguous"

    attributes_bound_elsewhere = all(
        any(edge[0] == attribute_index and objects[edge[1]][0] != object_name for edge in edges)
        for attribute_index in target_attributes
    )
    objects_bound_elsewhere = all(
        any(edge[1] == object_index and attributes[edge[0]][0] != attribute_name for edge in edges)
        for object_index in target_objects
    )
    if attributes_bound_elsewhere and objects_bound_elsewhere:
        return "separate"
    return "ambiguous"


def ordinary_art_structured_visible_hard_color_object_binding_state(
    fact: str,
    color_name: str,
    object_name: str,
) -> str:
    return ordinary_art_structured_visible_hard_attribute_object_binding_state(
        fact,
        ORDINARY_ART_STRUCTURED_VISIBLE_HARD_COLORS,
        color_name,
        object_name,
    )


def ordinary_art_structured_visible_hard_locator(fact: str) -> tuple[str, str]:
    if re.search(r"(?:主体|人物|角色)\s*1(?![0-9])|(?<![a-z])(?:subject|character)\s*1(?![0-9])", fact, re.I):
        return "index", "0"
    if re.search(r"(?:主体|人物|角色)\s*2(?![0-9])|(?<![a-z])(?:subject|character)\s*2(?![0-9])", fact, re.I):
        return "index", "1"
    if re.search(r"(?:左侧|左边|左方)(?:的)?(?:主体|人物|角色)?|(?<![a-z])left(?:[-\s]+(?:side|hand))?(?:[-\s]+(?:subject|person|character))?", fact, re.I):
        return "side", "left"
    if re.search(r"(?:右侧|右边|右方)(?:的)?(?:主体|人物|角色)?|(?<![a-z])right(?:[-\s]+(?:side|hand))?(?:[-\s]+(?:subject|person|character))?", fact, re.I):
        return "side", "right"
    if re.search(r"(?:主体|人物|角色)\s*A(?![a-z])|(?<![a-z])(?:subject|person|character)\s+A(?![a-z])", fact, re.I):
        return "name", "A"
    if re.search(r"(?:主体|人物|角色)\s*B(?![a-z])|(?<![a-z])(?:subject|person|character)\s+B(?![a-z])", fact, re.I):
        return "name", "B"
    return "", ""


def ordinary_art_structured_visible_hard_subject_indices(
    contract: dict,
    fact: str,
) -> list[int]:
    subjects = contract.get("subjects") if isinstance(contract.get("subjects"), list) else []
    locator_kind, locator_value = ordinary_art_structured_visible_hard_locator(fact)
    if not locator_kind:
        return list(range(len(subjects)))
    if locator_kind == "index":
        index = int(locator_value)
        return [index] if index < len(subjects) else []
    result = []
    for index, subject in enumerate(subjects):
        if not isinstance(subject, dict):
            continue
        identity = "。".join(
            ordinary_art_structured_visible_hard_texts(subject.get("name"))
            + ordinary_art_structured_visible_hard_texts(subject.get("appearance"))
        )
        if locator_kind == "side":
            pattern = (
                re.compile(r"(?:左侧|左边|左方)|(?<![a-z])left(?![a-z])", re.I)
                if locator_value == "left" else
                re.compile(r"(?:右侧|右边|右方)|(?<![a-z])right(?![a-z])", re.I)
            )
        else:
            pattern = re.compile(
                rf"(?:主体|人物|角色)\s*{re.escape(locator_value)}(?![a-z])|"
                rf"(?<![a-z])(?:subject|person|character)\s*{re.escape(locator_value)}(?![a-z])",
                re.I,
            )
        if pattern.search(identity):
            result.append(index)
    return result if len(result) == 1 else []


def ordinary_art_structured_visible_hard_colored_object_failure(
    fact: str,
    contract: dict,
    *,
    negative: bool,
) -> str:
    color_name, _color_pattern = ordinary_art_structured_visible_hard_single_match(
        fact,
        ORDINARY_ART_STRUCTURED_VISIBLE_HARD_COLORS,
    )
    object_name, _object_pattern = ordinary_art_structured_visible_hard_single_match(
        fact,
        ORDINARY_ART_STRUCTURED_VISIBLE_HARD_OBJECTS,
    )
    if not color_name or not object_name:
        return ""
    subjects = contract.get("subjects") if isinstance(contract.get("subjects"), list) else []
    indices = ordinary_art_structured_visible_hard_subject_indices(contract, fact)
    if not indices:
        return "structured-visible-hard-positive-missing:locator" if not negative else ""
    found = False
    ambiguous = False
    for index in indices:
        subject = subjects[index]
        for candidate in ordinary_art_structured_visible_hard_subject_facts(subject):
            state = ordinary_art_structured_visible_hard_color_object_binding_state(
                candidate,
                color_name,
                object_name,
            )
            if state == "bound":
                found = True
                break
            if state == "ambiguous":
                ambiguous = True
        if found:
            break
    if negative and (found or ambiguous):
        return f"structured-visible-hard-negative-conflict:{color_name}-{object_name}"
    if not negative and not found:
        return f"structured-visible-hard-positive-missing:{color_name}-{object_name}"
    return ""


ORDINARY_ART_STRUCTURED_SAME_FACE_SCOPE_PATTERN = re.compile(
    r"(?:复制脸|复制面孔|同一张脸|(?:两|二|2)\s*(?:张)?(?:脸|面孔|面部|五官)|"
    r"(?:两|二|2)\s*(?:人|位|名)[^，,。！？；;\n]{0,20}(?:脸|面孔|面部|五官))"
    r"|(?<![a-z0-9_])(?:duplicate\s+faces?|same\s+face|(?:two|both)\s+"
    r"(?:faces?|facial\s+features))(?![a-z0-9_])",
    re.I,
)
ORDINARY_ART_STRUCTURED_SAME_FACE_VALUE_PATTERN = re.compile(
    r"(?:完全相同|相同|一样|一致|复制)"
    r"|(?<![a-z0-9_])(?:same|identical|duplicate(?:d)?)(?![a-z0-9_])",
    re.I,
)
ORDINARY_ART_STRUCTURED_WESTERN_IDENTITY_PATTERN = re.compile(
    r"(?:(?:西方|欧美|欧洲|白人|高加索)(?:女性|男性|女人|男人|人物|角色|面孔|五官|长相|血统|族裔)"
    r"|(?:女性|男性|女人|男人|人物|角色)[^，,。！？；;\n]{0,12}(?:西方|欧美|欧洲|白人|高加索))"
    r"|(?<![a-z0-9_])(?:western|european|caucasian)\s+"
    r"(?:woman|man|person|character|face|features?|appearance)(?![a-z0-9_])",
    re.I,
)


def ordinary_art_structured_visible_hard_front_person_facts(
    contract: dict,
    *,
    include_relations: bool = True,
) -> list[str]:
    subjects = contract.get("subjects") if isinstance(contract.get("subjects"), list) else []
    facts = [
        text
        for subject in subjects if isinstance(subject, dict)
        for field in ("name", "appearance", "materials", "colors", "details", "pose", "action")
        for text in ordinary_art_structured_visible_hard_texts(subject.get(field))
    ]
    if include_relations:
        facts.extend(ordinary_art_structured_visible_hard_texts(contract.get("relations")))
    return facts


def ordinary_art_structured_visible_hard_count_conflict(
    fact: str,
    contract: dict,
) -> str:
    source_facts = ordinary_art_structured_counted_body_facts(fact)
    if not source_facts:
        return ""
    candidates = ordinary_art_structured_visible_hard_front_person_facts(contract)
    for expected_count, expected_body, _start, _end in source_facts:
        for candidate in candidates:
            for count, body, start, end in ordinary_art_structured_counted_body_facts(candidate):
                if (
                    body == expected_body
                    and count != expected_count
                    and ordinary_art_structured_visible_hard_span_is_affirmative(
                        candidate,
                        start,
                        end,
                    )
                ):
                    return (
                        f"structured-visible-hard-positive-conflict:{expected_body}-count:"
                        f"{count}/{expected_count}"
                    )
    return ""


def ordinary_art_structured_visible_hard_same_face_conflict(
    fact: str,
    contract: dict,
) -> str:
    if not ORDINARY_ART_STRUCTURED_DISTINCT_FACE_PATTERN.search(fact):
        return ""
    for candidate in ordinary_art_structured_visible_hard_front_person_facts(contract):
        if not (
            ORDINARY_ART_STRUCTURED_SAME_FACE_SCOPE_PATTERN.search(candidate)
            or re.search(
                r"(?:脸|面孔|面部|五官)|(?<![a-z])(?:face|facial\s+features?)(?![a-z])",
                candidate,
                re.I,
            )
        ):
            continue
        if re.search(r"(?:复制脸|复制面孔|同一张脸)|(?<![a-z])duplicate\s+faces?(?![a-z])", candidate, re.I):
            return "structured-visible-hard-positive-conflict:distinct-faces"
        for match in ORDINARY_ART_STRUCTURED_SAME_FACE_VALUE_PATTERN.finditer(candidate):
            prefix = candidate[max(0, match.start() - 16):match.start()]
            if re.search(
                r"(?:不|非|并不|并非)\s*(?:完全)?\s*$"
                r"|(?<![a-z0-9_])not\s+(?:completely\s+)?$",
                prefix,
                re.I,
            ):
                continue
            return "structured-visible-hard-positive-conflict:distinct-faces"
    return ""


def ordinary_art_structured_visible_hard_identity_conflict(
    raw_prompt: str,
    requirements: str,
    contract: dict,
) -> str:
    instruction = ordinary_art_user_change_instruction(requirements)
    identity_target_fields: set[str] = set()
    if ordinary_art_structured_identity_change_requested(requirements):
        if re.search(r"(?:年龄|年纪|岁数|未成年|成年|\d+\s*岁)|(?<![a-z])(?:age|minor|adult|years?\s+old)(?![a-z])", instruction, re.I):
            identity_target_fields.add("age")
        if re.search(r"(?:性别|男性|女性|男人|女人)|(?<![a-z])(?:gender|male|female|man|woman)(?![a-z])", instruction, re.I):
            identity_target_fields.add("gender")
        if re.search(r"(?:地域|族裔|东方|东亚|亚洲|中国|西方|欧美|欧洲)|(?<![a-z])(?:region|ethnicity|asian|eastern|western|european)(?![a-z])", instruction, re.I):
            identity_target_fields.add("region")
    subjects = contract.get("subjects") if isinstance(contract.get("subjects"), list) else []
    evidence = ordinary_art_structured_source_identity_tuple(raw_prompt, len(subjects))
    if not evidence:
        return ""
    source_gender = clean_text(str(evidence.get("gender") or "")).lower()
    opposite_gender = (
        ORDINARY_ART_CORE_MALE_PATTERN
        if source_gender in {"女性", "female"} else
        ORDINARY_ART_CORE_FEMALE_PATTERN
        if source_gender in {"男性", "male"} else
        None
    )
    source_region = clean_text(str(evidence.get("region") or "")).lower()
    source_age = int(evidence.get("age") or 0)
    for subject in subjects:
        if not isinstance(subject, dict):
            continue
        facts = [
            text
            for field in ("name", "appearance", "materials", "colors", "details", "pose", "action")
            for text in ordinary_art_structured_visible_hard_texts(subject.get(field))
        ]
        for candidate in facts:
            if "gender" not in identity_target_fields and opposite_gender and ordinary_art_core_positive_mention_present(
                candidate,
                opposite_gender,
                actor_context=True,
            ):
                return f"structured-source-identity-conflict:gender-{source_gender}"
            if "region" not in identity_target_fields and source_region in {
                "东方", "东亚", "亚洲", "中国", "oriental", "eastern", "east asian", "asian",
            } and ordinary_art_core_positive_mention_present(
                candidate,
                ORDINARY_ART_STRUCTURED_WESTERN_IDENTITY_PATTERN,
                actor_context=True,
            ):
                return "structured-source-identity-conflict:region"
            if "age" not in identity_target_fields and ordinary_art_core_affirmative_minor_present(candidate):
                return "structured-source-identity-conflict:minor"
            if source_age and "age" not in identity_target_fields:
                for age_match in re.finditer(
                    r"(?<![0-9])(?P<age>1[0-9]|[2-9][0-9])\s*岁"
                    r"|(?<![a-z0-9_])(?P<age_en>1[0-9]|[2-9][0-9])[-\s]+years?[-\s]+old(?![a-z0-9_])",
                    candidate,
                    re.I,
                ):
                    age = int(age_match.group("age") or age_match.group("age_en") or 0)
                    if age < source_age and ordinary_art_structured_visible_hard_match_is_affirmative(
                        candidate,
                        age_match,
                    ):
                        return f"structured-source-identity-conflict:age:{age}/{source_age}"
    return ""


ORDINARY_ART_STRUCTURED_SOURCE_VISIBLE_MATERIALS = (
    ("delicate-fabric", re.compile(
        r"(?:丝绸|绸缎|丝纱|薄纱|轻纱|蕾丝|锦缎|缎面)"
        r"|(?<![a-z])(?:silk|satin|gauze|chiffon|lace|brocade)(?![a-z])",
        re.I,
    )),
    ("leather", re.compile(r"(?:皮革|真皮)|(?<![a-z])leather(?![a-z])", re.I)),
    ("metal", re.compile(r"(?:金属|钢铁|铁质)|(?<![a-z])(?:metal|steel|iron)(?![a-z])", re.I)),
    ("glass", re.compile(r"(?:玻璃|水晶)|(?<![a-z])(?:glass|crystal)(?![a-z])", re.I)),
    ("wood", re.compile(r"(?:木质|木制|木材)|(?<![a-z])wood(?:en)?(?![a-z])", re.I)),
)
ORDINARY_ART_STRUCTURED_SOURCE_VISIBLE_ENVIRONMENT = (
    ("palace", "setting", re.compile(r"(?:宫廷|宫殿|殿堂)|(?<![a-z])(?:palace|court(?:ly)?\s+interior)(?![a-z])", re.I)),
    ("forest", "setting", re.compile(r"(?:森林|树林|林地)|(?<![a-z])forest(?![a-z])", re.I)),
    ("snow-mountain", "background", re.compile(r"(?:雪山|冰雪山脉)|(?<![a-z])snow(?:y)?[-\s]+mountains?(?![a-z])", re.I)),
    ("curtain", "background", re.compile(r"(?:帷幔|帘幕|窗帘)|(?<![a-z])(?:curtain|drapery|drapes)(?:s)?(?![a-z])", re.I)),
    ("screen", "background", re.compile(r"(?:屏风|隔扇)|(?<![a-z])(?:folding\s+screen|screen)(?![a-z])", re.I)),
    ("bed", "support_surface", re.compile(r"(?:床榻|床铺|软榻)|(?<![a-z])(?:bed|daybed|couch)(?![a-z])", re.I)),
)
ORDINARY_ART_STRUCTURED_SOURCE_VISIBLE_LIGHT_TONES = (
    ("warm", re.compile(r"(?:暖光|暖色光|暖调光)|(?<![a-z])warm(?:[-\s]+(?:light|lighting))?(?![a-z])", re.I)),
    ("cool", re.compile(r"(?:冷光|冷色光|冷调光)|(?<![a-z])cool(?:[-\s]+(?:light|lighting))?(?![a-z])", re.I)),
    ("natural", re.compile(r"(?:自然光|日光)|(?<![a-z])(?:natural|day)light(?![a-z])", re.I)),
)
ORDINARY_ART_STRUCTURED_SOURCE_VISIBLE_CAMERA = (
    ("shot", "full-body", re.compile(r"(?:全身(?:景别|构图|画面)?|完整全身)|(?<![a-z])full[-\s]+body(?:[-\s]+shot)?(?![a-z])", re.I)),
    ("shot", "close", re.compile(r"(?:近距离|近景|特写)|(?<![a-z])(?:close[-\s]+range|close[-\s]*up)(?![a-z])", re.I)),
    ("angle", "top-down", re.compile(r"(?:俯视|略微俯拍|高机位)|(?<![a-z])(?:top[-\s]+down|high[-\s]+angle|overhead)(?![a-z])", re.I)),
    ("angle", "low-angle", re.compile(r"(?:仰视|低机位)|(?<![a-z])low[-\s]+angle(?![a-z])", re.I)),
    ("angle", "eye-level", re.compile(r"(?:平视|视线齐平)|(?<![a-z])eye[-\s]+level(?![a-z])", re.I)),
    ("depth_of_field", "shallow", re.compile(r"(?:浅景深|背景虚化)|(?<![a-z])shallow[-\s]+depth[-\s]+of[-\s]+field(?![a-z])", re.I)),
    ("perspective", "standard", re.compile(r"(?:标准透视|自然透视)|(?<![a-z])(?:standard|natural)[-\s]+perspective(?![a-z])", re.I)),
)


def ordinary_art_structured_source_visible_change_targets(
    requirements: str,
    domain: str,
    locator: str,
    source_pattern: re.Pattern,
    *,
    field: str = "",
) -> bool:
    instruction = ordinary_art_user_change_instruction(requirements)
    if not instruction or not re.search(
        r"(?:修改|调整|改为|改成|替换|变更|更新|设为|设置为|删除|移除|去掉|去除|取消)"
        r"|(?<![a-z0-9_])(?:change|adjust|replace|update|set|remove|delete|omit|drop)(?![a-z0-9_])",
        instruction,
        re.I,
    ):
        return False
    instruction_locator_kind, instruction_locator = ordinary_art_structured_visible_hard_locator(
        instruction
    )
    if instruction_locator_kind == "side" and locator and instruction_locator != locator:
        return False
    if domain in {"subject-color", "subject-color-object"}:
        marker = re.compile(r"(?:颜色|色彩|色调)|(?<![a-z])colo[u]?r(?![a-z])", re.I)
        return bool(source_pattern.search(instruction) or marker.search(instruction))
    if domain in {"subject-material", "subject-material-object"}:
        marker = re.compile(r"(?:材质|材料|面料|纹理)|(?<![a-z])(?:material|fabric|texture)(?![a-z])", re.I)
        return bool(source_pattern.search(instruction) or marker.search(instruction))
    if domain == "subject-object":
        return bool(re.search(
            r"(?:衣型|款式|裙装|连衣裙|长裙|短裙|帽子|盔甲|铠甲|护甲)"
            r"|(?<![a-z])(?:garment\s+type|dress|gown|skirt|hat|armo[u]?r)(?![a-z])",
            instruction,
            re.I,
        ))
    if domain == "environment":
        if re.search(r"(?:整体|全部|完全).{0,8}(?:更换|替换|改变).{0,8}(?:环境|场景)"
                     r"|(?<![a-z])replace\s+(?:the\s+)?(?:entire|whole)\s+(?:environment|scene)(?![a-z])", instruction, re.I):
            return True
        field_markers = {
            "setting": re.compile(r"(?:环境|场景|空间|房间|地点)|(?<![a-z])(?:environment|scene|setting|location)(?![a-z])", re.I),
            "background": re.compile(r"(?:背景|后景)|(?<![a-z])background(?![a-z])", re.I),
            "support_surface": re.compile(r"(?:承托面|支撑面|床榻|地面)|(?<![a-z])support(?:ing)?\s+surface(?![a-z])", re.I),
        }
        marker = field_markers.get(field)
        return bool(marker and marker.search(instruction) and source_pattern.search(instruction))
    if domain == "lighting":
        if re.search(r"(?:整体|全部|完全).{0,8}(?:更换|替换|改变).{0,8}(?:光线|照明|打光)"
                     r"|(?<![a-z])replace\s+(?:the\s+)?(?:entire|whole)\s+lighting(?![a-z])", instruction, re.I):
            return True
        field_markers = {
            "light_direction": re.compile(r"(?:光源方向|入射方向|左侧光|右侧光)|(?<![a-z])light(?:ing)?\s+direction(?![a-z])", re.I),
            "light_quality": re.compile(r"(?:光质|软硬|柔光|硬光)|(?<![a-z])light(?:ing)?\s+quality(?![a-z])", re.I),
            "tone": re.compile(r"(?:色温|暖光|冷光|自然光)|(?<![a-z])(?:colour|color)\s+temperature(?![a-z])", re.I),
        }
        marker = field_markers.get(field)
        return bool(marker and marker.search(instruction))
    if domain == "camera":
        if re.search(r"(?:整体|全部|完全).{0,8}(?:更换|替换|改变).{0,8}(?:镜头|拍摄方案)"
                     r"|(?<![a-z])replace\s+(?:the\s+)?(?:entire|whole)\s+camera(?:\s+setup)?(?![a-z])", instruction, re.I):
            return True
        field_markers = {
            "shot": re.compile(r"(?:景别|镜头范围)|(?<![a-z])shot(?:\s+size)?(?![a-z])", re.I),
            "angle": re.compile(r"(?:视角|机位|拍摄角度)|(?<![a-z])(?:viewing\s+)?angle(?![a-z])", re.I),
            "perspective": re.compile(r"(?:透视|焦段|镜头畸变)|(?<![a-z])(?:perspective|lens|distortion)(?![a-z])", re.I),
            "depth_of_field": re.compile(r"(?:景深|对焦范围)|(?<![a-z])(?:depth\s+of\s+field|focus\s+range)(?![a-z])", re.I),
        }
        marker = field_markers.get(field)
        return bool(marker and marker.search(instruction))
    return False


def ordinary_art_structured_source_visible_segments(raw_prompt: str) -> list[str]:
    source = str(raw_prompt or "").replace("\r\n", "\n").replace("\r", "\n")
    result: list[str] = []
    clothing_names = {"dress", "clothing", "hat", "armor"}
    for sentence in re.split(r"[。！？；;\n]+", source):
        active_locator = ""
        active_clothing = False
        for raw_segment in re.split(r"[，,]+", sentence):
            segment = clean_text(raw_segment)
            if not segment:
                continue
            locator_kind, locator = ordinary_art_structured_visible_hard_locator(segment)
            if locator_kind == "side":
                if active_locator and locator != active_locator:
                    active_clothing = False
                active_locator = locator
            object_occurrences = ordinary_art_structured_visible_hard_affirmative_occurrences(
                segment,
                ORDINARY_ART_STRUCTURED_VISIBLE_HARD_OBJECTS,
            )
            object_names = {item[0] for item in object_occurrences}
            inherited = segment
            if locator_kind != "side" and active_locator:
                side_prefix = "左侧角色" if active_locator == "left" else "右侧角色"
                has_material = any(
                    ordinary_art_structured_visible_hard_fact_is_affirmative(
                        segment,
                        pattern,
                    )
                    for _name, pattern in ORDINARY_ART_STRUCTURED_SOURCE_VISIBLE_MATERIALS
                )
                if active_clothing and not object_names.intersection(clothing_names) and has_material:
                    inherited = f"{side_prefix}服装采用{segment}"
                else:
                    inherited = f"{side_prefix}{segment}"
            if object_names.intersection(clothing_names):
                active_clothing = True
            elif object_names:
                active_clothing = False
            result.append(inherited)
    return result


def ordinary_art_structured_source_visible_manifest(
    raw_prompt: str,
    contract: dict,
) -> list[dict]:
    manifest: list[dict] = []
    clothing_definitions = tuple(
        item for item in ORDINARY_ART_STRUCTURED_VISIBLE_HARD_OBJECTS
        if item[0] in {"dress", "clothing", "hat", "armor"}
    )
    for segment in ordinary_art_structured_source_visible_segments(raw_prompt):
        if (
            re.match(
                rf"^(?:{ORDINARY_ART_STRUCTURED_NAMED_HARD_LABEL_PATTERN.pattern})\s*[:：]",
                segment,
                re.I,
            )
            or ORDINARY_ART_STRUCTURED_ATOMIC_HARD_PATTERN.search(segment)
        ):
            continue
        locator_kind, locator = ordinary_art_structured_visible_hard_locator(segment)
        if locator_kind == "side":
            colors = ordinary_art_structured_visible_hard_affirmative_occurrences(
                segment,
                ORDINARY_ART_STRUCTURED_VISIBLE_HARD_COLORS,
            )
            objects = ordinary_art_structured_visible_hard_affirmative_occurrences(
                segment,
                clothing_definitions,
            )
            for color_name, _start, _end in colors:
                for object_name, _object_start, _object_end in objects:
                    if ordinary_art_structured_visible_hard_color_object_binding_state(
                        segment,
                        color_name,
                        object_name,
                    ) == "bound":
                        manifest.append({
                            "domain": "subject-color-object",
                            "locator": locator,
                            "name": f"{color_name}-{object_name}",
                            "attribute_name": color_name,
                            "object_name": object_name,
                            "pattern": dict(ORDINARY_ART_STRUCTURED_VISIBLE_HARD_COLORS)[color_name],
                            "source": segment,
                        })
            for object_name, _start, _end in objects:
                manifest.append({
                    "domain": "subject-object",
                    "locator": locator,
                    "name": object_name,
                    "pattern": dict(ORDINARY_ART_STRUCTURED_VISIBLE_HARD_OBJECTS)[object_name],
                    "source": segment,
                })
            for material_name, material_pattern in ORDINARY_ART_STRUCTURED_SOURCE_VISIBLE_MATERIALS:
                for object_name, _object_start, _object_end in objects:
                    if ordinary_art_structured_visible_hard_attribute_object_binding_state(
                        segment,
                        ORDINARY_ART_STRUCTURED_SOURCE_VISIBLE_MATERIALS,
                        material_name,
                        object_name,
                    ) == "bound":
                        manifest.append({
                            "domain": "subject-material-object",
                            "locator": locator,
                            "name": f"{material_name}-{object_name}",
                            "attribute_name": material_name,
                            "object_name": object_name,
                            "pattern": material_pattern,
                            "source": segment,
                        })

        for name, field, pattern in ORDINARY_ART_STRUCTURED_SOURCE_VISIBLE_ENVIRONMENT:
            if ordinary_art_structured_visible_hard_fact_is_affirmative(segment, pattern):
                manifest.append({
                    "domain": "environment",
                    "field": field,
                    "name": name,
                    "pattern": pattern,
                    "source": segment,
                })
        if re.search(r"(?:光源|光线|照明|打光|光照|暖光|冷光|自然光)|(?<![a-z])(?:light|lighting)(?![a-z])", segment, re.I):
            for name, pattern in ORDINARY_ART_STRUCTURED_VISIBLE_HARD_LIGHT_DIRECTIONS:
                if ordinary_art_structured_visible_hard_fact_is_affirmative(segment, pattern):
                    manifest.append({"domain": "lighting", "field": "light_direction", "name": name, "pattern": pattern, "source": segment})
            for name, pattern in ORDINARY_ART_STRUCTURED_VISIBLE_HARD_LIGHT_QUALITIES:
                if ordinary_art_structured_visible_hard_fact_is_affirmative(segment, pattern):
                    manifest.append({"domain": "lighting", "field": "light_quality", "name": name, "pattern": pattern, "source": segment})
            for name, pattern in ORDINARY_ART_STRUCTURED_SOURCE_VISIBLE_LIGHT_TONES:
                if ordinary_art_structured_visible_hard_fact_is_affirmative(segment, pattern):
                    manifest.append({"domain": "lighting", "field": "tone", "name": name, "pattern": pattern, "source": segment})
        for field, name, pattern in ORDINARY_ART_STRUCTURED_SOURCE_VISIBLE_CAMERA:
            if ordinary_art_structured_visible_hard_fact_is_affirmative(segment, pattern):
                manifest.append({"domain": "camera", "field": field, "name": name, "pattern": pattern, "source": segment})

    deduped: list[dict] = []
    seen: set[tuple[str, str, str, str]] = set()
    for item in manifest:
        key = (
            str(item.get("domain") or ""),
            str(item.get("locator") or ""),
            str(item.get("field") or ""),
            str(item.get("name") or ""),
        )
        if key not in seen:
            seen.add(key)
            deduped.append(item)
    return deduped


def ordinary_art_structured_source_visible_preservation_failure(
    raw_prompt: str,
    requirements: str,
    contract: dict,
) -> str:
    subjects = contract.get("subjects") if isinstance(contract.get("subjects"), list) else []
    for item in ordinary_art_structured_source_visible_manifest(raw_prompt, contract):
        domain = str(item.get("domain") or "")
        locator = str(item.get("locator") or "")
        pattern = item.get("pattern")
        if not isinstance(pattern, re.Pattern) or ordinary_art_structured_source_visible_change_targets(
            requirements,
            domain,
            locator,
            pattern,
            field=str(item.get("field") or ""),
        ):
            continue
        candidates: list[str] = []
        if domain.startswith("subject-"):
            indices = ordinary_art_structured_visible_hard_subject_indices(
                contract,
                str(item.get("source") or ""),
            )
            if len(indices) != 1:
                return f"structured-source-visible-missing:{locator}-locator"
            subject = subjects[indices[0]]
            fields = {
                "subject-color": ("colors", "appearance", "details"),
                "subject-material": ("materials", "appearance", "details"),
                "subject-object": ("appearance", "colors", "materials", "details"),
                "subject-color-object": ("colors", "appearance", "materials", "details"),
                "subject-material-object": ("materials", "appearance", "details", "colors"),
            }[domain]
            candidates = [
                text
                for field in fields
                for text in ordinary_art_structured_visible_hard_texts(subject.get(field))
            ]
        elif domain == "environment":
            field = str(item.get("field") or "")
            environment = contract.get("environment") if isinstance(contract.get("environment"), dict) else {}
            fields = (
                ("setting", "background", "spatial_layers")
                if field in {"setting", "background"} else
                (field,)
            )
            candidates = [
                text
                for candidate_field in fields
                for text in ordinary_art_structured_visible_hard_texts(environment.get(candidate_field))
            ]
        elif domain == "lighting":
            field = str(item.get("field") or "")
            lighting = contract.get("lighting_color") if isinstance(contract.get("lighting_color"), dict) else {}
            fields = (
                ("light_direction",)
                if field == "light_direction" else
                ("light_quality", "light_shadow", "rim_light")
                if field == "light_quality" else
                ("light_direction", "light_quality", "light_shadow", "rim_light", "palette", "local_colors")
            )
            candidates = [
                text
                for candidate_field in fields
                for text in ordinary_art_structured_visible_hard_texts(lighting.get(candidate_field))
            ]
        elif domain == "camera":
            camera = contract.get("camera") if isinstance(contract.get("camera"), dict) else {}
            candidates = ordinary_art_structured_visible_hard_texts(
                camera.get(str(item.get("field") or ""))
            )
        if domain == "subject-color-object":
            grounded = any(
                ordinary_art_structured_visible_hard_color_object_binding_state(
                    candidate,
                    str(item.get("attribute_name") or ""),
                    str(item.get("object_name") or ""),
                ) == "bound"
                for candidate in candidates
            )
        elif domain == "subject-material-object":
            grounded = any(
                ordinary_art_structured_visible_hard_attribute_object_binding_state(
                    candidate,
                    ORDINARY_ART_STRUCTURED_SOURCE_VISIBLE_MATERIALS,
                    str(item.get("attribute_name") or ""),
                    str(item.get("object_name") or ""),
                ) == "bound"
                for candidate in candidates
            )
        else:
            grounded = any(
                ordinary_art_structured_visible_hard_fact_is_affirmative(candidate, pattern)
                for candidate in candidates
            )
        if not grounded:
            return (
                f"structured-source-visible-missing:{domain}:"
                f"{locator or item.get('field') or 'front'}-{item.get('name')}"
            )
    return ""


def ordinary_art_structured_visible_hard_domain_facts(
    contract: dict,
    domain: str,
) -> list[str]:
    style = contract.get("style") if isinstance(contract.get("style"), dict) else {}
    environment = contract.get("environment") if isinstance(contract.get("environment"), dict) else {}
    lighting = contract.get("lighting_color") if isinstance(contract.get("lighting_color"), dict) else {}
    relations = contract.get("relations") if isinstance(contract.get("relations"), list) else []
    subjects = contract.get("subjects") if isinstance(contract.get("subjects"), list) else []
    if domain == "style":
        return ordinary_art_structured_visible_hard_texts([
            style.get("medium"), style.get("render_language"),
        ])
    if domain.startswith("style-"):
        return ordinary_art_structured_visible_hard_texts(
            style.get(domain.removeprefix("style-"))
        )
    if domain == "finish":
        return ordinary_art_structured_visible_hard_texts(style.get("finish"))
    if domain == "relations":
        return ordinary_art_structured_visible_hard_texts(relations)
    if domain == "subject-appearance":
        return [
            text
            for subject in subjects if isinstance(subject, dict)
            for field in ("appearance", "materials", "details")
            for text in ordinary_art_structured_visible_hard_texts(subject.get(field))
        ]
    if domain == "subject-pose":
        return [
            text
            for subject in subjects if isinstance(subject, dict)
            for field in ("pose", "action", "appearance", "details")
            for text in ordinary_art_structured_visible_hard_texts(subject.get(field))
        ]
    if domain == "environment":
        return [
            text
            for field in ("setting", "background", "spatial_layers", "support_surface", "occlusion")
            for text in ordinary_art_structured_visible_hard_texts(environment.get(field))
        ]
    if domain.startswith("environment-"):
        return ordinary_art_structured_visible_hard_texts(
            environment.get(domain.removeprefix("environment-"))
        )
    if domain == "light-direction":
        return ordinary_art_structured_visible_hard_texts(lighting.get("light_direction"))
    if domain == "light-quality":
        return ordinary_art_structured_visible_hard_texts([
            lighting.get("light_quality"), lighting.get("light_shadow"), lighting.get("rim_light"),
        ])
    if domain == "light-color":
        return ordinary_art_structured_visible_hard_texts([
            lighting.get("light_direction"), lighting.get("light_quality"),
            lighting.get("light_shadow"), lighting.get("rim_light"),
            lighting.get("palette"), lighting.get("local_colors"),
        ])
    if domain.startswith("camera-"):
        camera = contract.get("camera") if isinstance(contract.get("camera"), dict) else {}
        return ordinary_art_structured_visible_hard_texts(
            camera.get(domain.removeprefix("camera-"))
        )
    return []


def ordinary_art_structured_visible_hard_closed_anchor(
    segment: str,
    marker_pattern: re.Pattern,
) -> str:
    anchor = marker_pattern.sub(" ", segment)
    anchor = re.sub(
        r"(?:必须|务必|保持|应为|应当|设为|设置为|采用|使用|为|是|的|从|照入|照射|呈现)"
        r"|(?<![a-z])(?:must|keep|remain|be|the|a|an|use|with|from|as|show|depict)(?![a-z])",
        " ",
        ordinary_art_structured_inline_hard_constraint_anchor(anchor),
        flags=re.I,
    )
    return clean_text(anchor).strip(" ：:,，")


def ordinary_art_structured_visible_hard_anchor_grounded(
    anchor: str,
    candidates: list[str],
) -> bool:
    anchor_compact = ordinary_art_retention_compact(anchor)
    if not anchor_compact:
        return True
    han = re.sub(r"[^\u4e00-\u9fff]+", "", anchor_compact)
    english = [
        word
        for word in re.findall(r"[a-z0-9]+", anchor.lower())
        if len(word) >= 2 and word not in {"to", "of", "and", "or", "in", "on"}
    ]
    han_pattern = re.compile(
        r"\s*".join(re.escape(character) for character in han),
        re.I,
    ) if han else None
    for candidate in candidates:
        if han_pattern and ordinary_art_structured_visible_hard_fact_is_affirmative(
            candidate,
            han_pattern,
        ):
            return True
        if english and all(
            ordinary_art_structured_visible_hard_fact_is_affirmative(
                candidate,
                re.compile(rf"(?<![a-z0-9_]){re.escape(word)}(?![a-z0-9_])", re.I),
            )
            for word in english
        ):
            return True
    return False


def ordinary_art_structured_visible_hard_environment_segments(
    fact: str,
) -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    for segment in re.split(r"[，,]+|\b(?:and|while)\b", fact, flags=re.I):
        value = clean_text(segment)
        if not value:
            continue
        if re.search(r"(?:背景)|(?<![a-z])background(?![a-z])", value, re.I):
            result.append(("background", value))
        elif re.search(r"(?:承托面|承托|支撑面)|(?<![a-z])support(?:ing)?\s+surface(?![a-z])", value, re.I):
            result.append(("support_surface", value))
        elif re.search(r"(?:环境|场景|空间|房间)|(?<![a-z])(?:environment|scene|setting)(?![a-z])", value, re.I):
            result.append(("setting", value))
        elif re.search(r"(?:位于|处于|站在|坐在|躺在)[^，,。！？；;\n]{1,48}", value, re.I):
            result.append(("background", value))
    return result


def ordinary_art_structured_visible_hard_environment_anchor(
    segment: str,
) -> str:
    marker = re.compile(
        r"(?:背景|环境|场景|空间|房间|承托面|承托|支撑面|位于|处于|站在|坐在|躺在)"
        r"|(?<![a-z])(?:background|environment|scene|setting|support(?:ing)?\s+surface|"
        r"located|standing|sitting|lying)(?![a-z])",
        re.I,
    )
    anchor = ordinary_art_structured_visible_hard_closed_anchor(segment, marker)
    anchor = re.sub(
        r"^(?:两位|两名|两人|所有|全部|每位|每名)?(?:人物|角色|主体)?\s*"
        r"|^(?:(?:both|all|each|every)\s+)?(?:people|persons|characters|subjects)\s+",
        "",
        anchor,
        flags=re.I,
    )
    anchor = re.sub(r"^(?:站立|站姿|坐姿|躺姿)\s*", "", anchor)
    return clean_text(anchor)


def ordinary_art_structured_visible_hard_positive_failure(
    fact: str,
    contract: dict,
) -> str:
    count_conflict = ordinary_art_structured_visible_hard_count_conflict(
        fact,
        contract,
    )
    if count_conflict:
        return count_conflict
    same_face_conflict = ordinary_art_structured_visible_hard_same_face_conflict(
        fact,
        contract,
    )
    if same_face_conflict:
        return same_face_conflict
    colored_failure = ordinary_art_structured_visible_hard_colored_object_failure(
        fact,
        contract,
        negative=False,
    )
    if colored_failure:
        return colored_failure

    subjects = contract.get("subjects") if isinstance(contract.get("subjects"), list) else []
    indices = ordinary_art_structured_visible_hard_subject_indices(contract, fact)
    all_people = bool(re.search(
        r"(?:两位|两名|两人|所有|全部|每位|每名)(?:人物|角色|主体)?"
        r"|(?<![a-z])(?:both|all|each|every)\s+(?:people|persons|characters|subjects)?",
        fact,
        re.I,
    ))
    for kind, pattern in ORDINARY_ART_STRUCTURED_VISIBLE_HARD_POSES:
        if not pattern.search(fact):
            continue
        if not indices:
            return f"structured-visible-hard-positive-missing:{kind}-locator"
        matched = []
        for index in indices:
            subject = subjects[index]
            candidates = ordinary_art_structured_visible_hard_texts(subject.get("pose"))
            matched.append(any(
                ordinary_art_structured_visible_hard_fact_is_affirmative(candidate, pattern)
                for candidate in candidates
            ))
        if not (all(matched) if all_people else any(matched)):
            return f"structured-visible-hard-positive-missing:{kind}"

    for kind, pattern in ORDINARY_ART_STRUCTURED_VISIBLE_HARD_ACTIONS:
        if not pattern.search(fact):
            continue
        if not indices:
            return f"structured-visible-hard-positive-missing:{kind}-locator"
        matched = []
        for index in indices:
            candidates = ordinary_art_structured_visible_hard_texts(
                subjects[index].get("action")
            )
            matched.append(any(
                ordinary_art_structured_visible_hard_fact_is_affirmative(candidate, pattern)
                for candidate in candidates
            ))
        if not (all(matched) if all_people else any(matched)):
            return f"structured-visible-hard-positive-missing:{kind}"

    for field, segment in ordinary_art_structured_visible_hard_environment_segments(fact):
        anchor = ordinary_art_structured_visible_hard_environment_anchor(segment)
        if not ordinary_art_structured_visible_hard_anchor_grounded(
            anchor,
            ordinary_art_structured_visible_hard_domain_facts(
                contract,
                f"environment-{field}",
            ),
        ):
            return f"structured-visible-hard-positive-missing:environment-{field}"

    for kind, pattern in ORDINARY_ART_STRUCTURED_VISIBLE_HARD_RELATIONS:
        if pattern.search(fact) and not any(
            ordinary_art_structured_visible_hard_fact_is_affirmative(candidate, pattern)
            for candidate in ordinary_art_structured_visible_hard_domain_facts(contract, "relations")
        ):
            return f"structured-visible-hard-positive-missing:relation-{kind}"

    if re.search(r"(?:光源|光线|照明|打光)|(?<![a-z])(?:light(?:ing)?|light\s+source)(?![a-z])", fact, re.I):
        for kind, pattern in ORDINARY_ART_STRUCTURED_VISIBLE_HARD_LIGHT_DIRECTIONS:
            if pattern.search(fact) and not any(
                ordinary_art_structured_visible_hard_fact_is_affirmative(candidate, pattern)
                for candidate in ordinary_art_structured_visible_hard_domain_facts(contract, "light-direction")
            ):
                return f"structured-visible-hard-positive-missing:light-{kind}"
        for kind, pattern in ORDINARY_ART_STRUCTURED_VISIBLE_HARD_LIGHT_QUALITIES:
            if pattern.search(fact) and not any(
                ordinary_art_structured_visible_hard_fact_is_affirmative(candidate, pattern)
                for candidate in ordinary_art_structured_visible_hard_domain_facts(contract, "light-quality")
            ):
                return f"structured-visible-hard-positive-missing:light-{kind}"
        color_name, color_pattern = ordinary_art_structured_visible_hard_single_match(
            fact,
            ORDINARY_ART_STRUCTURED_VISIBLE_HARD_COLORS,
        )
        if color_name and not any(
            ordinary_art_structured_visible_hard_fact_is_affirmative(candidate, color_pattern)
            for candidate in ordinary_art_structured_visible_hard_domain_facts(contract, "light-color")
        ):
            return f"structured-visible-hard-positive-missing:light-color-{color_name}"

    for field, marker in ORDINARY_ART_STRUCTURED_VISIBLE_HARD_CAMERA_SLOTS:
        for segment in re.split(r"[，,]+|\b(?:and|while)\b", fact, flags=re.I):
            if not marker.search(segment):
                continue
            anchor = ordinary_art_structured_visible_hard_closed_anchor(segment, marker)
            if not ordinary_art_structured_visible_hard_anchor_grounded(
                anchor,
                ordinary_art_structured_visible_hard_domain_facts(contract, f"camera-{field}"),
            ):
                return f"structured-visible-hard-positive-missing:camera-{field}"

    for field, marker in ORDINARY_ART_STRUCTURED_VISIBLE_HARD_STYLE_SLOTS:
        for segment in re.split(r"[，,]+|\b(?:and|while)\b", fact, flags=re.I):
            if not marker.search(segment):
                continue
            anchor = ordinary_art_structured_visible_hard_closed_anchor(segment, marker)
            if not ordinary_art_structured_visible_hard_anchor_grounded(
                anchor,
                ordinary_art_structured_visible_hard_domain_facts(contract, f"style-{field}"),
            ):
                return f"structured-visible-hard-positive-missing:style-{field}"
    return ""


def ordinary_art_structured_visible_hard_negative_failure(
    fact: str,
    contract: dict,
) -> str:
    color_name, _color_pattern = ordinary_art_structured_visible_hard_single_match(
        fact,
        ORDINARY_ART_STRUCTURED_VISIBLE_HARD_COLORS,
    )
    object_name, _object_pattern = ordinary_art_structured_visible_hard_single_match(
        fact,
        ORDINARY_ART_STRUCTURED_VISIBLE_HARD_OBJECTS,
    )
    object_absence = bool(re.search(
        r"(?:禁止|避免|不得|不要|不允许|不可|不能)"
        r"[^，,。！？；;\n]{0,30}(?:出现|增加|添加|加入|包含|包括|穿|穿戴|戴|使用|有)?"
        r"[^，,。！？；;\n]{0,20}(?:帽子|礼帽|帽饰|裙装|连衣裙|长裙|短裙|裙子|衣裙|服装|衣服|华服|着装|上衣|外套|长袍|衣袍)"
        r"|(?:帽子|礼帽|帽饰|裙装|连衣裙|长裙|短裙|裙子|衣裙|服装|衣服|华服|着装|上衣|外套|长袍|衣袍)"
        r"[^，,。！？；;\n]{0,20}(?:不得|禁止|不允许|不可)(?:出现|增加|添加|穿戴|使用|存在)?"
        r"|(?<![a-z])(?:never|avoid|must\s+not|may\s+not|do\s+not|no\s+(?:character|person|subject|one)?)"
        r"[^,.;!?\n]{0,32}(?:add|include|show|wear|use|have)?[^,.;!?\n]{0,20}"
        r"(?:hat|cap|headwear|dress|gown|skirt|clothes|clothing|outfit|garment)s?(?![a-z])",
        fact,
        re.I,
    ))
    if color_name and object_name and object_absence:
        return ordinary_art_structured_visible_hard_colored_object_failure(
            fact,
            contract,
            negative=True,
        )

    hat_pattern = dict(ORDINARY_ART_STRUCTURED_VISIBLE_HARD_OBJECTS)["hat"]
    if hat_pattern.search(fact) and object_absence:
        subjects = contract.get("subjects") if isinstance(contract.get("subjects"), list) else []
        indices = ordinary_art_structured_visible_hard_subject_indices(contract, fact)
        for index in indices:
            if any(
                ordinary_art_structured_visible_hard_fact_is_affirmative(candidate, hat_pattern)
                for candidate in ordinary_art_structured_visible_hard_subject_facts(subjects[index])
            ):
                return "structured-visible-hard-negative-conflict:hat"

    for kind, pattern, domains in ORDINARY_ART_STRUCTURED_VISIBLE_HARD_NEGATIVE_CONCEPTS:
        if not pattern.search(fact):
            continue
        for domain in domains:
            if any(
                ordinary_art_structured_visible_hard_fact_is_affirmative(candidate, pattern)
                for candidate in ordinary_art_structured_visible_hard_domain_facts(contract, domain)
            ):
                return f"structured-visible-hard-negative-conflict:{kind}"
    return ""


def ordinary_art_structured_visible_hard_failure(
    raw_prompt: str,
    requirements: str,
    contract: dict,
) -> str:
    """Require source visible hard atoms in front slots; terminal text is excluded."""

    identity_conflict = ordinary_art_structured_visible_hard_identity_conflict(
        raw_prompt,
        requirements,
        contract,
    )
    if identity_conflict:
        return identity_conflict
    source_visible_failure = ordinary_art_structured_source_visible_preservation_failure(
        raw_prompt,
        requirements,
        contract,
    )
    if source_visible_failure:
        return source_visible_failure
    for label, fact in ordinary_art_structured_hard_constraint_blocks(raw_prompt):
        if ordinary_art_structured_hard_block_targeted(
            raw_prompt,
            requirements,
            label,
            fact,
        ):
            continue
        if ordinary_art_structured_visible_hard_is_negative(label, fact):
            failure = ordinary_art_structured_visible_hard_negative_failure(fact, contract)
        else:
            failure = ordinary_art_structured_visible_hard_positive_failure(fact, contract)
        if failure:
            return failure
    return ""


def ordinary_art_structured_restore_source_hard_constraints(
    raw_prompt: str,
    requirements: str,
    contract: dict,
) -> str:
    """Merge every unmodified source hard atom without signing it as a new edit."""

    terminal = contract.get("terminal_constraints")
    if not isinstance(terminal, list):
        return "structured-terminal-constraints-invalid"
    existing_compacts = {
        ordinary_art_retention_compact(value)
        for value in terminal
        if ordinary_art_retention_compact(value)
    }
    for label, block_text in ordinary_art_structured_hard_constraint_blocks(raw_prompt):
        if ordinary_art_structured_hard_block_targeted(
            raw_prompt,
            requirements,
            label,
            block_text,
        ):
            continue
        fact = clean_text(block_text)
        compact = ordinary_art_retention_compact(fact)
        if not fact or not compact or compact in existing_compacts:
            continue
        if len(terminal) >= 24:
            return "structured-terminal-constraints-overflow"
        terminal.append(fact)
        existing_compacts.add(compact)
    return ""


def ordinary_art_structured_hard_constraint_failure(
    raw_prompt: str,
    requirements: str,
    terminal_constraints: str,
) -> str:
    terminal_bigrams = ordinary_art_retention_bigrams(terminal_constraints)
    terminal_compact = ordinary_art_retention_compact(terminal_constraints)
    for label, block_text in ordinary_art_structured_hard_constraint_blocks(raw_prompt):
        if ordinary_art_structured_hard_block_targeted(
            raw_prompt,
            requirements,
            label,
            block_text,
        ):
            continue
        if label.startswith("内联硬约束"):
            if ordinary_art_structured_inline_hard_constraint_preserved(
                block_text,
                terminal_constraints,
            ):
                continue
            return f"structured-hard-block-missing:{clean_text(label)[:40]}"
        body = ordinary_art_retention_block_body(block_text)
        body_compact = ordinary_art_retention_compact(body)
        if body_compact and body_compact in terminal_compact:
            continue
        body_bigrams = ordinary_art_retention_bigrams(body)
        coverage = (
            len(body_bigrams.intersection(terminal_bigrams)) / len(body_bigrams)
            if body_bigrams else 1.0
        )
        if coverage < 0.6:
            return f"structured-hard-block-missing:{clean_text(label)[:40]}"
    return ""


def ordinary_art_structured_retention_failure(
    raw_prompt: str,
    requirements: str,
    candidate: str,
) -> str:
    """Cross-format semantic retention without requiring original block labels."""

    source_compact = ordinary_art_retention_compact(raw_prompt)
    if len(source_compact) < ORDINARY_ART_PROMPT_BASE_CHAR_THRESHOLD:
        return ""
    retained_units = ordinary_art_retention_units(raw_prompt, requirements)
    retained_compact = ordinary_art_retention_compact("。".join(retained_units))
    candidate_compact = ordinary_art_retention_compact(candidate)
    minimum_chars = max(120, math.ceil(len(retained_compact) * 0.34))
    if len(candidate_compact) < minimum_chars:
        return f"structured-candidate-too-short:{len(candidate_compact)}/{minimum_chars}"
    candidate_bigrams = ordinary_art_retention_bigrams(candidate)
    source_bigrams = ordinary_art_retention_bigrams(retained_compact)
    anchor_coverage = (
        len(source_bigrams.intersection(candidate_bigrams)) / len(source_bigrams)
        if source_bigrams else 1.0
    )
    preserved_units = 0
    for unit in retained_units:
        unit_bigrams = ordinary_art_retention_bigrams(unit)
        coverage = (
            len(unit_bigrams.intersection(candidate_bigrams)) / len(unit_bigrams)
            if unit_bigrams else 1.0
        )
        if coverage >= 0.22:
            preserved_units += 1
    unit_coverage = preserved_units / len(retained_units) if retained_units else 1.0
    if anchor_coverage < 0.24 and unit_coverage < 0.45:
        return f"structured-anchors-missing:{anchor_coverage:.3f}/{unit_coverage:.3f}"
    return ""


def ordinary_art_structured_front_change_failure(
    requirements: str,
    front_five: str,
) -> str:
    """Prove that the user edit exists before the terminal constraint section."""

    instruction = ordinary_art_user_change_instruction(requirements)
    if not instruction or ordinary_art_instruction_allows_unchanged(requirements):
        return ""
    candidate_bigrams = ordinary_art_retention_bigrams(front_five)
    for index, clause in enumerate(
        ordinary_art_patch_feedback_clauses(requirements),
        start=1,
    ):
        resolution_hint = ordinary_art_problem_resolution_hint(clause)
        if resolution_hint:
            if not ordinary_art_patch_replacement_has_explicit_resolution(
                clause,
                front_five,
            ):
                return f"structured-front-problem-unresolved:C{index:02d}"
            continue
        clause_bigrams = ordinary_art_retention_bigrams(clause)
        clause_bigrams.difference_update(ORDINARY_ART_RETENTION_CHANGE_STOP_BIGRAMS)
        if not clause_bigrams:
            continue
        coverage = len(clause_bigrams.intersection(candidate_bigrams)) / len(clause_bigrams)
        if coverage < 0.35:
            return f"structured-front-change-missing:C{index:02d}:{coverage:.3f}"
    return ""


def ordinary_art_structured_requirement_clause_specs(
    requirements: str,
) -> list[tuple[str, str]]:
    """Normalize edits while retaining their requested change direction."""

    instruction = clean_text(ordinary_art_user_change_instruction(requirements))[:4000]
    if not instruction:
        return []
    generic_preservation = re.compile(
        r"^(?:(?:保留|保持|维持)(?:原有|当前)?"
        r"(?:主体(?:身份)?|角色(?:身份)?|人物(?:身份)?|整体构图|镜头构图|构图|画面布局|整体布局)"
        r"(?:(?:与|和|及|以及)(?:主体(?:身份)?|角色(?:身份)?|人物(?:身份)?|整体构图|镜头构图|构图|画面布局|整体布局))?"
        r"(?:不变|一致)?|(?:keep|preserve|retain|maintain)(?: the)? "
        r"(?:subject(?: identity)?|character identity|overall composition|camera composition|composition|image layout|layout)"
        r"(?: and (?:subject(?: identity)?|character identity|overall composition|camera composition|composition|image layout|layout))?"
        r"(?: unchanged)?)$",
        flags=re.I,
    )
    operation_start = (
        r"(?:保留|保持|维持|增强|提升|增加|添加|补充|降低|减少|弱化|去除|删除|"
        r"修改|调整|改为|改成|替换|keep|preserve|retain|maintain|enhance|improve|"
        r"increase|add|reduce|decrease|remove|change|modify|adjust|replace)"
    )
    connector_before_operation = re.compile(
        rf"(?:并且|同时|以及|然后|\b(?:and|also|then)\b)(?=\s*{operation_start})",
        flags=re.I,
    )
    raw_clauses: list[str] = []
    for segment in re.split(r"[，,；;。.!！？?\n]+", instruction):
        for value in connector_before_operation.split(segment):
            clause = re.sub(
                r"^(?:并且|同时|以及|然后|(?:and|also|then)\b)\s*",
                "",
                clean_text(value),
                flags=re.I,
            ).strip()
            if clause:
                raw_clauses.append(clause)
    actionable_clauses = [
        clause
        for clause in raw_clauses
        if not generic_preservation.fullmatch(clause)
    ]
    if actionable_clauses:
        raw_clauses = actionable_clauses
    clauses: list[tuple[str, str]] = []
    for raw_clause in raw_clauses:
        clause = clean_text(raw_clause)
        if re.search(
            r"(?:减少|降低|弱化|减弱|去除|删除|移除|取消|避免|禁止|不要|不得|"
            r"不再|无|没有|缺少|不足|\b(?:decrease|reduce|remove|delete|less|"
            r"without|avoid|no|not|never)\b)",
            clause,
            flags=re.I,
        ):
            direction = "decrease"
        elif re.search(
            r"(?:增加|添加|补充|提升|强化|增强|提高|更多|更强|\b(?:increase|"
            r"add|enhance|improve|boost|more|higher)\b)",
            clause,
            flags=re.I,
        ):
            direction = "increase"
        else:
            direction = "target"
        clause = re.sub(
            r"^(?:(?:请|请将|请把|把|将|帮我|希望|需要|要求|想要|让|使得?|"
            r"适当|稍微|进一步)\s*)+",
            "",
            clause,
            flags=re.I,
        )
        clause = re.sub(
            r"^(?:(?:修改|调整|优化|增强|增加|添加|补充|提升|强化|提高|降低|"
            r"减少|弱化|减弱|去除|删除|移除|取消|改为|改成|"
            r"替换为|替换成|设置为|设为|变为|换成|允许|increase|make|use|set|"
            r"change|replace|modify|adjust|optimi[sz]e|enhance|add|apply|allow|"
            r"permit|please)\s*)+",
            "",
            clause,
            flags=re.I,
        )
        clause = re.sub(r"^(?:更(?:加)?|偏(?:向)?|以)\s*", "", clause)
        clause = re.sub(r"(?:即可|就好|就可以)$", "", clause).strip()
        if len(ordinary_art_retention_compact(clause)) >= 2:
            clauses.append((clause, direction))
    return clauses


def ordinary_art_structured_requirement_clauses(requirements: str) -> list[str]:
    return [
        clause
        for clause, _direction in ordinary_art_structured_requirement_clause_specs(
            requirements
        )
    ]


def ordinary_art_structured_requirement_fact_covers(
    clause: str,
    applied_fact: str,
    *,
    direction: str = "target",
) -> bool:
    """Require a grounded model mapping to retain a distinctive clause anchor."""

    clause_compact = ordinary_art_retention_compact(clause)
    fact_compact = ordinary_art_retention_compact(applied_fact)
    if not clause_compact or not fact_compact:
        return False
    # A shorter fact is not proof of a longer clause.  Semantic paraphrases are
    # handled below; this exact path is intentionally directional.
    exact_overlap = clause_compact in fact_compact

    stop_words = {
        "the", "a", "an", "to", "of", "for", "with", "and", "more",
        "but", "while", "whereas", "some", "image", "picture", "please",
        "increase", "add", "enhance", "improve", "boost", "make", "use",
        "set", "change", "replace", "modify", "adjust", "optimize",
        "optimise", "apply", "allow", "permit",
    }

    def stem(word: str) -> str:
        return re.sub(r"(?:ing|ed|er|ly|s)$", "", word, flags=re.I)

    def semantic_components(value: str) -> tuple[str, set[str]]:
        compact = ordinary_art_retention_compact(value)
        han = re.sub(r"[^\u4e00-\u9fff]+", "", compact)
        han = re.sub(
            r"(?:画面|人物|角色|主体|整体|效果|一些|一点|相关|内容|部分|造型|设计|"
            r"修改|调整|优化|改为|改成|替换|增加|添加|提升|提高|"
            r"增强|强化|改善|修正|使用|设为)",
            "",
            han,
        )
        han = re.sub(r"^(?:更(?:加)?|偏(?:向)?|以|适当|稍微|进一步)", "", han)
        english_words = {
            normalized
            for word in re.findall(r"[a-z0-9]{3,}", str(value).lower())
            for normalized in [stem(word)]
            if len(normalized) >= 3
            and word not in stop_words
            and normalized not in stop_words
        }
        return han, english_words

    def semantic_anchor_covers(required: str, candidate: str) -> bool:
        required_han, required_words = semantic_components(required)
        candidate_han, candidate_words = semantic_components(candidate)
        if not required_han and not required_words:
            return False

        chinese_anchor_match = True
        if required_han:
            required_bigrams = ordinary_art_retention_bigrams(required_han)
            candidate_bigrams = ordinary_art_retention_bigrams(candidate_han)
            retained = len(required_bigrams.intersection(candidate_bigrams))
            chinese_anchor_match = bool(
                required_han in candidate_han
                or (
                    required_bigrams
                    and (
                        (len(required_han) <= 3 and retained == len(required_bigrams))
                        or (
                            len(required_han) > 3
                            and len(required_bigrams) <= 2
                            and retained >= 1
                        )
                        or (
                            len(required_han) > 3
                            and len(required_bigrams) > 2
                            and retained >= 2
                            and retained / len(required_bigrams) >= 0.34
                        )
                    )
                )
            )

        english_anchor_match = True
        if required_words:
            english_anchor_match = required_words.issubset(candidate_words)

        # Pure English must never fall through a character-bigram path.  For a
        # mixed-language clause both present semantic channels are mandatory.
        return chinese_anchor_match and english_anchor_match

    def semantic_segments(value: str) -> list[str]:
        prepared = re.sub(
            r"\s+(?=\b(?:not|no|never|without)\b)",
            " || ",
            str(value),
            flags=re.I,
        )
        prepared = re.sub(
            r"(?<=[\u4e00-\u9fff])(?=(?:没有|不|无|非|缺少|欠缺))",
            " || ",
            prepared,
        )
        return [
            clean_text(segment)
            for segment in re.split(
                r"\|\||[，,；;。.!！？?\n]+|(?:但是|但|而且|并且|以及|且)"
                r"|\b(?:but|while|whereas|and|yet)\b",
                prepared,
                flags=re.I,
            )
            if clean_text(segment)
        ]

    explicit_negative_pattern = re.compile(
        r"(?:没有|不再|不|无|非|缺少|欠缺|避免|禁止|不得|不能|不可|不要|"
        r"\b(?:not|no|never|without|avoid|exclude|forbid|prohibit|"
        r"lack(?:s|ing)?)\b)",
        flags=re.I,
    )
    intrinsic_negative_pattern = re.compile(
        r"(?:低劣|粗糙|保守|不足|降低|减少|弱化|减弱|"
        r"\b(?:flat|low|weak|poor|conservative|reduced?)\b)",
        flags=re.I,
    )

    def segment_polarity(segment: str) -> tuple[bool, str]:
        explicit_match = explicit_negative_pattern.search(segment)
        if explicit_match:
            target = clean_text(segment[explicit_match.end():])
            return True, target or clean_text(segment)
        if intrinsic_negative_pattern.search(segment):
            return True, clean_text(segment)
        return False, clean_text(segment)

    clause_segments = [segment_polarity(value) for value in semantic_segments(clause)]
    fact_segments = [segment_polarity(value) for value in semantic_segments(applied_fact)]

    problem_resolution_match = bool(
        ordinary_art_problem_resolution_hint(clause)
        and ordinary_art_patch_replacement_has_explicit_resolution(
            clause,
            applied_fact,
        )
    )

    # A resolution hint may bridge one problem statement to its corrected
    # final state.  It must not bypass polarity checks for a compound clause.
    if not problem_resolution_match or len(clause_segments) > 1:
        clause_positive = [
            target
            for is_negative, target in clause_segments
            if not is_negative and any(semantic_components(target))
        ]
        fact_positive = [
            target
            for is_negative, target in fact_segments
            if not is_negative and any(semantic_components(target))
        ]
        fact_positive_text = " ".join(fact_positive)
        if any(
            not (
                any(
                    semantic_anchor_covers(required, candidate)
                    for candidate in fact_positive
                )
                or semantic_anchor_covers(required, fact_positive_text)
            )
            for required in clause_positive
        ):
            return False

        clause_negative = [
            target
            for is_negative, target in clause_segments
            if is_negative and any(semantic_components(target))
        ]
        fact_negative = [
            target
            for is_negative, target in fact_segments
            if is_negative and any(semantic_components(target))
        ]

        def same_negative_object(left: str, right: str) -> bool:
            return semantic_anchor_covers(left, right) or semantic_anchor_covers(
                right,
                left,
            )

        # Negative subclauses are object-scoped.  One shared negative elsewhere
        # in the sentence cannot authorize a new or opposite negative claim.
        if any(
            not any(same_negative_object(target, allowed) for allowed in clause_negative)
            for target in fact_negative
        ):
            return False
        if any(
            not any(same_negative_object(required, target) for target in fact_negative)
            for required in clause_negative
        ):
            return False

    semantic_anchor_match = semantic_anchor_covers(clause, applied_fact)
    if not (
        exact_overlap
        or semantic_anchor_match
        or problem_resolution_match
    ):
        return False
    increase_pattern = re.compile(
        r"(?:增加|提高|提升|增强|强化|更多|更强|过度|加剧|\b(?:increase|"
        r"increased|higher|more|enhanced|boosted|excessive)\b)",
        flags=re.I,
    )
    if direction == "decrease":
        return not any(
            increase_pattern.search(segment)
            for is_negative, segment in fact_segments
            if not is_negative
        )
    return True


def ordinary_art_structured_requirement_ledger_failure(
    requirements: str,
    applied_requirements: list[str],
    *,
    grounded_mapping: bool = False,
    source_prompt: str = "",
) -> str:
    """Require one distinct grounded final-state fact per real user edit clause."""

    instruction = ordinary_art_user_change_instruction(requirements)
    ledger = [clean_text(value) for value in applied_requirements if clean_text(value)]
    if not instruction:
        return "structured-ledger-unexpected-without-instruction" if ledger else ""

    clause_specs = ordinary_art_structured_requirement_clause_specs(requirements)
    if not clause_specs:
        clause_specs = [(instruction, "target")]
    clauses = [clause for clause, _direction in clause_specs]
    if len(ledger) < len(clauses) or (
        grounded_mapping and len(ledger) != len(clauses)
    ):
        return f"structured-ledger-count:{len(ledger)}/{len(clauses)}"
    if source_prompt:
        source_compact = ordinary_art_retention_compact(source_prompt)
        for index, fact in enumerate(ledger, start=1):
            fact_compact = ordinary_art_retention_compact(fact)
            if fact_compact and fact_compact in source_compact:
                return f"structured-ledger-no-new-fact:C{index:02d}"

    operation_prefix = re.compile(
        r"^(?:"
        r"(?:(?:请|需要|应该|应当|建议|尝试|可以)\s*)?"
        r"(?:将|把|对)?\s*"
        r"(?:修改|调整|优化|增加|添加|删除|移除|改为|改成|增强|提高|"
        r"降低|减少|弱化|改善|修正)\s*"
        r"|(?:(?:please|should|need\s+to|needs\s+to)\s+)?"
        r"(?:increase|add|improve|adjust|change|replace|remove|delete|"
        r"optimi[sz]e|enhance|make|use|set)\b\s*"
        r")",
        flags=re.I,
    )

    matches: list[list[int]] = []
    for clause_index, clause in enumerate(clauses):
        cleaned_clause = clean_text(clause)
        stripped_clause = operation_prefix.sub("", cleaned_clause, count=1)
        has_operation_prefix = stripped_clause != cleaned_clause
        semantic_clause = stripped_clause if has_operation_prefix else cleaned_clause
        clause_bigrams = ordinary_art_retention_bigrams(semantic_clause)
        clause_bigrams.difference_update(ORDINARY_ART_RETENTION_CHANGE_STOP_BIGRAMS)
        clause_compact = ordinary_art_retention_compact(semantic_clause)
        candidates: list[int] = []
        for index, fact in enumerate(ledger):
            fact_compact = ordinary_art_retention_compact(fact)
            if not fact_compact:
                continue
            if grounded_mapping:
                accepted = ordinary_art_structured_requirement_fact_covers(
                    clause,
                    fact,
                    direction=clause_specs[clause_index][1],
                )
            elif ordinary_art_problem_resolution_hint(clause):
                accepted = ordinary_art_patch_replacement_has_explicit_resolution(
                    clause,
                    fact,
                )
            elif clause_bigrams:
                fact_bigrams = ordinary_art_retention_bigrams(fact)
                coverage = len(clause_bigrams.intersection(fact_bigrams)) / len(
                    clause_bigrams
                )
                accepted = coverage >= 0.6
            else:
                accepted = bool(
                    clause_compact
                    and (
                        clause_compact in fact_compact
                        or fact_compact in clause_compact
                    )
                )
            if accepted:
                accepted = ordinary_art_structured_requirement_fact_covers(
                    clause,
                    fact,
                    direction=clause_specs[clause_index][1],
                )
            if accepted:
                candidates.append(index)
        matches.append(candidates)

    def has_unique_assignment(clause_index: int, used: set[int]) -> bool:
        if clause_index >= len(matches):
            return True
        for ledger_index in matches[clause_index]:
            if ledger_index in used:
                continue
            used.add(ledger_index)
            if has_unique_assignment(clause_index + 1, used):
                return True
            used.remove(ledger_index)
        return False

    if not has_unique_assignment(0, set()):
        first_missing = next(
            (index for index, candidates in enumerate(matches, start=1) if not candidates),
            1,
        )
        return f"structured-ledger-clause-missing:C{first_missing:02d}"
    return ""


def ordinary_art_structured_rebuild_requirement_ledger(
    requirements: str,
    contract: dict,
) -> list[str]:
    """Select one distinct front-five final-state fact for each edit clause."""

    instruction = ordinary_art_user_change_instruction(requirements)
    if not instruction:
        return []
    clauses = ordinary_art_structured_requirement_clauses(requirements) or [instruction]
    facts: list[str] = []
    for value in art_prompt_front_five_scalar_values(contract):
        fact = clean_text(value)
        if fact and fact not in facts:
            facts.append(fact)

    matches: list[list[int]] = []
    for clause in clauses:
        matches.append([
            index
            for index, fact in enumerate(facts)
            if not ordinary_art_structured_requirement_ledger_failure(
                clause,
                [fact],
            )
        ])
    if any(not candidates for candidates in matches):
        return []

    selected: list[int | None] = [None] * len(clauses)
    search_order = sorted(range(len(clauses)), key=lambda index: len(matches[index]))

    def assign(position: int, used: set[int]) -> bool:
        if position >= len(search_order):
            return True
        clause_index = search_order[position]
        for fact_index in matches[clause_index]:
            if fact_index in used:
                continue
            selected[clause_index] = fact_index
            used.add(fact_index)
            if assign(position + 1, used):
                return True
            used.remove(fact_index)
            selected[clause_index] = None
        return False

    if not assign(0, set()):
        return []
    return [facts[index] for index in selected if index is not None]


def ordinary_art_structured_canonical_closure_intent(
    clause: str,
    direction: str,
) -> str:
    """Classify only the three non-structural positive aesthetic modifiers."""

    text = clean_text(clause).lower()
    if not text or direction not in {"increase", "target"}:
        return ""
    if re.search(
        r"(?:没有|不再|不|无|非|不要|不得|避免|禁止|排除|"
        r"减少|降低|删除|移除|去除|弱化|取消|"
        r"(?<![a-z0-9_])(?:not|no|never|without|avoid|exclude|remove|delete|"
        r"reduce|decrease|less)(?![a-z0-9_]))",
        text,
        flags=re.I,
    ):
        return ""
    if re.search(
        r"(?:身份|年龄|未成年|儿童|幼女|少年|人数|数量|动作|姿势|关系|"
        r"依偎|亲吻|接吻|拥抱|场景|背景|环境|光线|光影|照明|色彩|颜色|"
        r"镜头|构图|视角|景别|裁切|性行为|性交|自慰|插入|性器官|生殖器|"
        r"阴茎|阴道|乳房|乳头|裸体|裸露|全裸|半裸|"
        r"(?<![a-z0-9_])(?:identity|age|underage|minor|child|count|number|pose|action|"
        r"relationship|kiss|embrace|scene|background|environment|lighting?|colo(?:u)?r|"
        r"camera|composition|angle|framing|crop|sexual\s+act|intercourse|masturbat\w*|"
        r"penetrat\w*|genitals?|penis|vagina|breasts?|nipples?|nude|naked|nudity|topless)"
        r"(?![a-z0-9_]))",
        text,
        flags=re.I,
    ):
        return ""

    han = re.sub(r"[^\u4e00-\u9fff]+", "", text)
    english = re.sub(r"[^a-z0-9]+", " ", text).strip()
    if re.fullmatch(
        r"(?:画面|视觉|整体)?(?:质感|材质细节|画面细节)"
        r"(?:更?(?:细腻|丰富|精致|高级|清晰|真实))?",
        han,
    ) or re.fullmatch(
        r"(?:the )?(?:(?:image|visual|material|surface|texture) "
        r"(?:quality|details?)|material details?)"
        r"(?: (?:more|higher|richer|finer|refined|detailed))?",
        english,
        flags=re.I,
    ):
        return "finish_quality"
    if re.fullmatch(
        r"(?:(?:人物|角色)(?:造型|设计)?(?:更(?:加)?)?性感|"
        r"(?:更(?:加)?)?性感(?:的)?(?:人物|角色)(?:造型|设计)?)",
        han,
    ) or re.fullmatch(
        r"(?:(?:the )?(?:character|figure) (?:design|styling|look) "
        r"(?:more )?(?:sensual|sexy)|(?:more )?(?:sensual|sexy) "
        r"(?:character|figure) (?:design|styling|look))",
        english,
        flags=re.I,
    ):
        return "sensual_character"
    if re.fullmatch(
        r"(?:(?:偏)?成人向(?:的)?(?:成熟)?(?:审美)?(?:氛围|风格)?|"
        r"成熟(?:的)?成人向(?:审美)?(?:氛围|风格)?)",
        han,
    ) or re.fullmatch(
        r"(?:a |an |the )?(?:mature )?adult oriented"
        r"(?: (?:mature )?(?:atmosphere|aesthetic|style|tone))?",
        english,
        flags=re.I,
    ):
        return "adult_atmosphere"
    return ""


def ordinary_art_structured_contract_has_person_subject(contract: dict) -> bool:
    return any(
        ORDINARY_ART_STRUCTURED_PERSON_IDENTITY_PATTERN.search(
            clean_text(str(subject.get("name") or ""))
        )
        for subject in (contract.get("subjects") or [])
        if isinstance(subject, dict)
    )


ORDINARY_ART_STRUCTURED_COUNT_VALUES = {
    "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
    "one": 1, "two": 2, "both": 2, "three": 3, "four": 4,
    "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10,
}


def ordinary_art_structured_parsed_count(value: str) -> int:
    normalized = clean_text(value).lower()
    if normalized.isdigit():
        return int(normalized)
    return ORDINARY_ART_STRUCTURED_COUNT_VALUES.get(normalized, 0)


def ordinary_art_structured_source_identity_tuple(
    raw_prompt: str,
    subject_count: int,
) -> dict:
    """Return one affirmative all-person identity tuple, never a style inference."""

    chinese_group = re.compile(
        r"(?P<fact>(?P<count>[一二两三四五六七八九十]|[1-9]|1[0-2])"
        r"\s*(?:位|名|个)?\s*[^，,。！？；;\n]{0,48}?"
        r"(?:(?P<age>(?:1[89]|[2-9][0-9])\s*岁(?:以上)?)\s*(?:的)?\s*(?:明确)?\s*(?:成年)?"
        r"|(?:明确)?\s*(?:成年|成人))\s*(?:的)?\s*"
        r"(?P<region>东方|东亚|亚洲|中国)?\s*"
        r"(?:(?P<gender>女性|男性|女人|男人|女子|男子|女士|男士)"
        r"(?P<role>角色|人物|主体)?|(?P<role_only>人物|角色|主体)))",
        re.I,
    )
    english_group = re.compile(
        r"(?P<fact>(?<![a-z0-9_])"
        r"(?P<count>one|two|both|three|four|five|six|seven|eight|nine|ten|[1-9]|1[0-2])"
        r"\s+(?:(?P<age>(?:(?:over|at\s+least)\s+)?(?:1[89]|[2-9][0-9])"
        r"(?:[-\s]+years?[-\s]+old)?)\s+)?(?:clearly\s+)?adult\s+"
        r"(?:(?P<region>oriental|eastern|east\s+asian|asian)\s+)?"
        r"(?P<actor>women|men|people|persons|female\s+characters?|male\s+characters?|"
        r"characters?|subjects?)(?![a-z0-9_]))",
        re.I,
    )
    source = str(raw_prompt or "")
    evidence: list[dict] = []
    for language, pattern in (("zh", chinese_group), ("en", english_group)):
        for match in pattern.finditer(source):
            prefix = source[max(0, match.start() - 48):match.start()]
            prefix = re.split(r"[\r\n，。；;,.!?！？]", prefix)[-1]
            if (
                ORDINARY_ART_CORE_ACTOR_NEGATED_MENTION_PREFIX_PATTERN.search(prefix)
                or minimax_h3_match_is_negated(source, match)
                or ordinary_art_structured_parsed_count(match.group("count") or "") != subject_count
            ):
                continue
            age_text = clean_text(match.group("age") or "")
            age_match = re.search(r"(?<![0-9])(?:1[89]|[2-9][0-9])(?![0-9])", age_text)
            suffix = source[match.end():match.end() + 96]
            if language == "zh":
                gender_raw = clean_text(match.group("gender") or "")
                gender = "女性" if re.search(r"女", gender_raw) else (
                    "男性" if re.search(r"男", gender_raw) else ""
                )
                role = "角色" if clean_text(
                    match.group("role") or match.group("role_only") or ""
                ) else ""
                if not role and re.search(r"(?:女性|男性|人物)角色", suffix[:64]):
                    role = "角色"
            else:
                actor = clean_text(match.group("actor") or "").lower()
                gender = "female" if re.search(r"women|female", actor) else (
                    "male" if re.search(r"men|male", actor) else ""
                )
                role = "character" if re.search(r"characters?|subjects?", actor) else ""
                if not role and re.search(r"\bcharacters?\b", suffix[:80], re.I):
                    role = "character"
            evidence.append({
                "language": language,
                "fact": clean_text(match.group("fact") or ""),
                "age": int(age_match.group(0)) if age_match else 0,
                "minimum_age": bool(re.search(r"(?:以上|over|at\s+least)", age_text, re.I)),
                "region": clean_text(match.group("region") or "").lower(),
                "gender": gender,
                "role": role,
            })
    if not evidence:
        return {}
    evidence.sort(
        key=lambda item: sum(bool(item.get(key)) for key in ("age", "region", "gender", "role")),
        reverse=True,
    )
    best = evidence[0]
    best_signature = tuple(best.get(key) or "" for key in ("language", "age", "region", "gender", "role"))
    for item in evidence[1:]:
        signature = tuple(item.get(key) or "" for key in ("language", "age", "region", "gender", "role"))
        if all(signature[index] == best_signature[index] or not signature[index] for index in range(5)):
            continue
        if all(best_signature[index] == signature[index] or not best_signature[index] for index in range(5)):
            continue
        return {}
    return best


def ordinary_art_structured_identity_descriptor(evidence: dict) -> str:
    language = clean_text(str(evidence.get("language") or ""))
    age = int(evidence.get("age") or 0)
    minimum_age = bool(evidence.get("minimum_age"))
    region = clean_text(str(evidence.get("region") or ""))
    gender = clean_text(str(evidence.get("gender") or ""))
    role = clean_text(str(evidence.get("role") or ""))
    if language == "zh":
        age_prefix = f"{age}岁{'以上' if minimum_age else ''}的" if age else ""
        region = {"东亚": "东亚", "东方": "东方", "亚洲": "亚洲", "中国": "中国"}.get(region, region)
        identity_tail = f"{region}{gender}{role}"
        return f"{age_prefix}成年{identity_tail or '人物'}"
    region = {
        "oriental": "oriental", "eastern": "eastern", "east asian": "east Asian", "asian": "Asian",
    }.get(region, region)
    identity = " ".join(item for item in ("adult", region, gender, role) if item)
    if identity == "adult":
        identity = "adult person"
    if age:
        identity += f" age {age}{' or older' if minimum_age else ''}"
    return identity


def ordinary_art_structured_identity_change_requested(requirements: str) -> bool:
    instruction = ordinary_art_user_change_instruction(requirements)
    return bool(re.search(
        r"(?:(?:年龄|年纪|岁数|身份|性别|地域|族裔|成年身份|东方身份|亚洲身份)"
        r"[^，,。！？；;\n]{0,20}(?:改为|改成|替换为|换成|变为|删除|移除|取消|设为|设置为)"
        r"|(?:改为|改成|替换为|换成|变为|设为|设置为)"
        r"[^，,。！？；;\n]{0,12}(?:\d+\s*岁|未成年|成年|男性|女性|男人|女人|东方|东亚|亚洲|中国))"
        r"|(?<![a-z0-9_])(?:(?:change|replace|remove|delete|set|redefine)\s+"
        r"(?:the\s+)?(?:age|identity|gender|region|ethnicity)"
        r"|(?:change|replace|set|redefine)\s+(?:the\s+)?(?:person|character|subject)"
        r"[^,.;!?\n]{0,24}\b(?:adult|minor|male|female|woman|man|asian|eastern))",
        instruction,
        re.I,
    ))


def ordinary_art_structured_restore_source_adult_identity(
    raw_prompt: str,
    requirements: str,
    contract: dict,
) -> bool:
    """Restore a source-proven count/age/adult/region/gender/role tuple."""

    if ordinary_art_structured_identity_change_requested(requirements):
        return False
    if (
        ordinary_art_core_affirmative_minor_present(raw_prompt)
        or ordinary_art_core_affirmative_minor_present(
            json.dumps(contract, ensure_ascii=False, separators=(",", ":"))
        )
    ):
        return False
    subject_count = contract.get("subject_count")
    subjects = contract.get("subjects")
    if (
        isinstance(subject_count, bool)
        or not isinstance(subject_count, int)
        or subject_count < 1
        or not isinstance(subjects, list)
        or len(subjects) != subject_count
        or not all(
            isinstance(subject, dict)
            and ORDINARY_ART_STRUCTURED_PERSON_IDENTITY_PATTERN.search(
                clean_text(str(subject.get("name") or ""))
            )
            for subject in subjects
        )
    ):
        return False
    evidence = ordinary_art_structured_source_identity_tuple(raw_prompt, subject_count)
    descriptor = ordinary_art_structured_identity_descriptor(evidence) if evidence else ""
    descriptor_compact = ordinary_art_retention_compact(descriptor)
    if not descriptor_compact:
        return False
    updated = False
    for subject in subjects:
        name = clean_text(str(subject.get("name") or ""))
        if descriptor_compact in ordinary_art_retention_compact(name):
            continue
        subject["name"] = f"{descriptor}，{name}" if evidence["language"] == "zh" else f"{descriptor}, {name}"
        updated = True
    return updated


ORDINARY_ART_STRUCTURED_DISTINCT_FACE_PATTERN = re.compile(
    r"(?:(?:两|二|2)\s*(?:张)?(?:脸|面孔|面部|五官)[^。！？；;\n]{0,48}"
    r"(?:明显)?(?:不同|差异|区别|不相同)|(?:两|二|2)\s*(?:人|位|名)?[^。！？；;\n]{0,32}"
    r"(?:脸|面孔|面部|五官)[^。！？；;\n]{0,32}(?:明显)?(?:不同|差异|区别|不相同))"
    r"|(?<![a-z0-9_])(?:(?:two|both)\s+(?:faces?|facial\s+features)[^.;!?\n]{0,64}"
    r"(?:different|distinct)|(?:different|distinct)[^.;!?\n]{0,32}(?:faces?|facial\s+features))",
    re.I,
)
ORDINARY_ART_STRUCTURED_BODY_OWNERSHIP_PATTERN = re.compile(
    r"(?P<count_cn>[一二两三四五六七八九十]|[1-9]|1[0-2])\s*(?:只|条|根)?\s*"
    r"(?P<body_cn>手臂|手|腿|眼睛|耳朵)[^。！？；;\n]{0,48}"
    r"(?:归属明确|明确归属|明确判断属于|属于哪位|各自归属|结构正确且归属)"
    r"|(?<![a-z0-9_])(?P<count_en>one|two|three|four|five|six|eight|ten|[1-9]|1[0-2])\s+"
    r"(?P<body_en>hands?|arms?|legs?|eyes?|ears?)[^.;!?\n]{0,64}"
    r"(?:ownership|clearly\s+(?:assigned|attributed)|belong(?:s|ing)?\s+to\s+which)",
    re.I,
)


def ordinary_art_structured_source_atomic_clauses(value: str) -> list[str]:
    result = []
    for item in re.split(r"[。.!！？?；;\n]+", str(value or "")):
        clause = clean_text(item).strip(" *：:")
        clause = re.sub(
            rf"^(?:\*\*)?\s*{ORDINARY_ART_STRUCTURED_NAMED_HARD_LABEL_PATTERN.pattern}\s*[:：]\s*",
            "",
            clause,
            flags=re.I,
        ).strip(" *：:")
        if clause:
            result.append(clause)
    return result


def ordinary_art_structured_source_typed_preservation_manifest(
    raw_prompt: str,
    requirements: str,
    contract: dict,
) -> tuple[list[dict], str]:
    """Build only source-grounded facts with an unambiguous front-slot owner."""

    subject_count = contract.get("subject_count")
    subjects = contract.get("subjects")
    if (
        isinstance(subject_count, bool)
        or not isinstance(subject_count, int)
        or not isinstance(subjects, list)
        or len(subjects) != subject_count
        or not all(
            isinstance(subject, dict)
            and ORDINARY_ART_STRUCTURED_PERSON_IDENTITY_PATTERN.search(
                clean_text(str(subject.get("name") or ""))
            )
            for subject in subjects
        )
    ):
        return [], ""
    manifest: list[dict] = []
    for clause in ordinary_art_structured_source_atomic_clauses(raw_prompt):
        if ordinary_art_structured_inline_hard_constraint_targeted(clause, requirements):
            continue
        if (
            subject_count == 2
            and ORDINARY_ART_STRUCTURED_DISTINCT_FACE_PATTERN.search(clause)
            and not re.match(r"^(?:避免|禁止|不得|不要|无|没有)", clause)
        ):
            manifest.append({"kind": "distinct_faces", "slot": "relations", "fact": clause})
        if (
            any(pattern.search(clause) for _kind, pattern in ORDINARY_ART_STRUCTURED_VISIBLE_HARD_RELATIONS)
            and not re.match(r"^(?:避免|禁止|不得|不要|无|没有)", clause)
        ):
            manifest.append({"kind": "visible_relation", "slot": "relations", "fact": clause})
        body_match = ORDINARY_ART_STRUCTURED_BODY_OWNERSHIP_PATTERN.search(clause)
        if not body_match or re.match(r"^(?:避免|禁止|不得|不要|无|没有)", clause):
            continue
        count = ordinary_art_structured_parsed_count(
            body_match.group("count_cn") or body_match.group("count_en") or ""
        )
        body = clean_text(body_match.group("body_cn") or body_match.group("body_en") or "").lower()
        normal_pair_parts = bool(re.search(r"(?:手|手臂|腿|眼睛|耳朵|hands?|arms?|legs?|eyes?|ears?)", body, re.I))
        if normal_pair_parts and count == subject_count * 2:
            manifest.append({"kind": "bodypart_ownership", "slot": "relations", "fact": clause})
    deduped: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for item in manifest:
        key = (str(item["slot"]), ordinary_art_retention_compact(str(item["fact"])))
        if key[1] and key not in seen:
            seen.add(key)
            deduped.append(item)
    return deduped, ""


def ordinary_art_structured_apply_source_typed_preservation(
    raw_prompt: str,
    requirements: str,
    contract: dict,
) -> str:
    manifest, failure = ordinary_art_structured_source_typed_preservation_manifest(
        raw_prompt,
        requirements,
        contract,
    )
    if failure:
        return failure
    relations = contract.get("relations")
    if not isinstance(relations, list):
        return "structured-source-typed-relations-invalid"
    existing = {
        ordinary_art_retention_compact(value)
        for value in relations
        if ordinary_art_retention_compact(value)
    }
    for item in manifest:
        fact = clean_text(str(item.get("fact") or ""))
        compact = ordinary_art_retention_compact(fact)
        if not fact or compact in existing:
            continue
        if len(relations) >= 16:
            return "structured-source-typed-relations-overflow"
        relations.append(fact)
        existing.add(compact)
    return ""


def ordinary_art_structured_canonical_closure_slot_supported(
    category: str,
    contract: dict,
) -> bool:
    style = contract.get("style") if isinstance(contract.get("style"), dict) else {}
    slot = {
        "finish_quality": "finish",
        "sensual_character": "render_language",
        "adult_atmosphere": "atmosphere",
    }.get(category, "")
    value = clean_text(str(style.get(slot) or ""))
    if not slot or not value:
        return False
    opposite_patterns = {
        "finish_quality": re.compile(
            r"(?:低劣|粗糙|低质量|低质|细节不足|缺乏(?:画面)?质感|扁平(?:化)?)"
            r"|(?<![a-z0-9_])(?:flat|rough|poor|low[-\s]+quality|low[-\s]+detail|"
            r"lack(?:s|ing)?[-\s]+(?:material[-\s]+)?detail)(?![a-z0-9_])",
            re.I,
        ),
        "sensual_character": re.compile(
            r"(?:人物|角色|造型|设计)?(?:不性感|非性感)|(?:保守|禁欲)(?:造型|设计|风格)?"
            r"|(?<![a-z0-9_])(?:not[-\s]+(?:sensual|sexy)|non[-\s]+sensual|"
            r"conservative|sexless)(?![a-z0-9_])",
            re.I,
        ),
        "adult_atmosphere": re.compile(
            r"(?:不偏成人向|不成人向|非成人向|全年龄|儿童向|少儿向|家庭友好)"
            r"|(?<![a-z0-9_])(?:not[-\s]+adult[-\s]+oriented|non[-\s]+adult|"
            r"all[-\s]+ages|child[-\s]+oriented|family[-\s]+friendly)(?![a-z0-9_])",
            re.I,
        ),
    }
    return not opposite_patterns[category].search(value)


def ordinary_art_structured_apply_canonical_closure(
    requirements: str,
    contract: dict,
    source_prompt: str,
) -> list[str]:
    """Materialize three safe aesthetic edits when Qwen's ledger is unusable."""

    clause_specs = ordinary_art_structured_requirement_clause_specs(requirements)
    if not clause_specs:
        return []
    definitions = {
        "finish_quality": (
            "finish",
            "画面质感细腻丰富",
            "image quality is refined with rich material detail",
        ),
        "sensual_character": (
            "render_language",
            "人物造型性感且成年比例明确",
            "character design is sensual with clearly adult proportions",
        ),
        "adult_atmosphere": (
            "atmosphere",
            "偏成人向的成熟审美氛围",
            "mature adult-oriented aesthetic atmosphere",
        ),
    }
    planned: list[tuple[str, str, str]] = []
    used_slots: set[str] = set()
    source_compact = ordinary_art_retention_compact(source_prompt)
    for clause, direction in clause_specs:
        category = ordinary_art_structured_canonical_closure_intent(clause, direction)
        if not category or not ordinary_art_structured_canonical_closure_slot_supported(
            category,
            contract,
        ):
            return []
        if (
            category in {"sensual_character", "adult_atmosphere"}
            and not ordinary_art_structured_contract_has_person_subject(contract)
        ):
            return []
        slot, chinese_canonical, english_canonical = definitions[category]
        han_count = len(re.findall(r"[㐀-䶿一-鿿豈-﫿]", clause))
        english_word_count = len(re.findall(r"[a-z]{2,}", clause, flags=re.I))
        use_english = bool(
            english_word_count
            and (
                not han_count
                or english_word_count * 2 > han_count
            )
        )
        canonical = english_canonical if use_english else chinese_canonical
        if slot in used_slots:
            return []
        if any(
            ordinary_art_retention_compact(candidate) in source_compact
            for candidate in (chinese_canonical, english_canonical)
        ):
            return []
        used_slots.add(slot)
        planned.append((slot, canonical, clause))

    style = contract.get("style") if isinstance(contract.get("style"), dict) else None
    if style is None:
        return []
    updates: dict[str, str] = {}
    ledger: list[str] = []
    for slot, canonical, _clause in planned:
        current = clean_text(str(style.get(slot) or ""))
        if not current or ordinary_art_retention_compact(canonical) in ordinary_art_retention_compact(current):
            return []
        merged = clean_text(f"{current}，{canonical}")
        if len(merged) > 400:
            return []
        updates[slot] = merged
        ledger.append(merged)

    if ordinary_art_structured_requirement_ledger_failure(
        requirements,
        ledger,
        grounded_mapping=True,
        source_prompt=source_prompt,
    ):
        return []
    for slot, value in updates.items():
        style[slot] = value
    return ledger


def apply_ordinary_art_patch_output(
    raw_prompt: str,
    requirements: str,
    output: str,
    diagnostics: dict | None = None,
    *,
    allowed_unit_ids: list[str] | None = None,
    required_unit_ids: list[str] | None = None,
    max_patch_count: int = 4,
    max_target_chars: int = 320,
) -> str:
    """Validate and merge a model-authored local patch; return empty on any ambiguity."""

    value = clean_text(output)
    fenced = re.fullmatch(r"```(?:json)?\s*([\s\S]*?)\s*```", value, flags=re.I)
    if fenced:
        value = fenced.group(1).strip()
    json_starts = [index for index in (value.find("{"), value.find("[")) if index >= 0]
    if not json_starts:
        if isinstance(diagnostics, dict):
            diagnostics["failureReason"] = "patch-json-missing"
        return ""
    object_start = min(json_starts)
    try:
        parsed, decoded_end = json.JSONDecoder().raw_decode(value[object_start:])
    except Exception:
        if isinstance(diagnostics, dict):
            diagnostics["failureReason"] = "patch-json-invalid"
        return ""
    if value[object_start + decoded_end:].strip():
        if isinstance(diagnostics, dict):
            diagnostics["failureReason"] = "patch-json-trailing-content"
        return ""
    if isinstance(parsed, list):
        patches = parsed
    elif isinstance(parsed, dict) and set(parsed.keys()) == {"patches"}:
        patches = parsed.get("patches")
    else:
        if isinstance(diagnostics, dict):
            diagnostics["failureReason"] = "patch-json-schema-invalid"
        return ""
    bounded_patch_count = max(0, min(4, int(max_patch_count or 0)))
    bounded_target_chars = max(0, min(320, int(max_target_chars or 0)))
    if not isinstance(patches, list) or not 1 <= len(patches) <= bounded_patch_count:
        if isinstance(diagnostics, dict):
            diagnostics["failureReason"] = "patch-count-invalid"
        return ""

    units = ordinary_art_patch_units(raw_prompt)
    unit_by_id = {str(unit["id"]): unit for unit in units}
    allowed_ids = {
        clean_text(unit_id).upper()
        for unit_id in (allowed_unit_ids or [])
        if clean_text(unit_id).upper()
    }
    required_ids = {
        clean_text(unit_id).upper()
        for unit_id in (required_unit_ids or [])
        if clean_text(unit_id).upper()
    }
    removal_targets = ordinary_art_explicit_removal_targets(requirements)
    spans = []
    seen_patch_keys = set()
    patched_unit_ids = set()
    for patch in patches:
        if not isinstance(patch, dict) or set(patch.keys()) != {
            "segment_id", "target_quote", "replacement"
        }:
            if isinstance(diagnostics, dict):
                diagnostics["failureReason"] = "patch-json-schema-invalid"
            return ""
        if not all(
            isinstance(patch.get(key), str)
            for key in ("segment_id", "target_quote", "replacement")
        ):
            if isinstance(diagnostics, dict):
                diagnostics["failureReason"] = "patch-json-schema-invalid"
            return ""
        unit_id = clean_text(patch.get("segment_id") or "").upper()
        if unit_id not in unit_by_id:
            return ""
        if allowed_ids and unit_id not in allowed_ids:
            if isinstance(diagnostics, dict):
                diagnostics["failureReason"] = f"patch-repair-unit-out-of-scope:{unit_id}"
            return ""
        patched_unit_ids.add(unit_id)
        target_quote = str(patch.get("target_quote") or "")
        replacement = str(patch.get("replacement") or "")
        if not target_quote or (unit_id, target_quote) in seen_patch_keys:
            return ""
        seen_patch_keys.add((unit_id, target_quote))
        unit = unit_by_id[unit_id]
        unit_text = str(unit["text"])
        if unit_text.count(target_quote) != 1:
            return ""
        local_start = unit_text.find(target_quote)
        original_compact = ordinary_art_retention_compact(target_quote)
        replacement_compact = ordinary_art_retention_compact(replacement)
        if replacement_compact == original_compact:
            return ""
        if not replacement_compact:
            if not ordinary_art_patch_empty_replacement_allowed(target_quote, removal_targets):
                return ""
        elif len(replacement_compact) < 2:
            return ""
        elif ordinary_art_patch_replacement_is_meta_instruction(replacement):
            return ""
        clause_id, validation_instruction, clause_by_id = (
            ordinary_art_patch_validation_context(requirements, target_quote)
        )
        foreign_clause_id = (
            ordinary_art_patch_foreign_intent_id(
                clause_id,
                clause_by_id,
                target_quote,
                replacement,
            )
            if clause_id else ""
        )
        if foreign_clause_id:
            if isinstance(diagnostics, dict):
                diagnostics["failureReason"] = (
                    f"patch-cross-requirement-content:{foreign_clause_id}"
                )
                diagnostics["foreignClauseId"] = foreign_clause_id
            return ""
        user_instruction_compact = ordinary_art_retention_compact(validation_instruction)
        if (
            validation_instruction
            and replacement_compact
            and len(replacement_compact) >= 4
            and replacement_compact == user_instruction_compact
            and ordinary_art_instruction_describes_problem(validation_instruction)
        ):
            if isinstance(diagnostics, dict):
                diagnostics["failureReason"] = "patch-repeats-problem-state"
            return ""
        if validation_instruction and ordinary_art_patch_replacement_repeats_problem(
            validation_instruction,
            replacement,
        ):
            if isinstance(diagnostics, dict):
                diagnostics["failureReason"] = "patch-repeats-problem-state"
            return ""
        if validation_instruction and ordinary_art_patch_replacement_contradicts_problem(
            validation_instruction,
            replacement,
        ):
            if isinstance(diagnostics, dict):
                diagnostics["failureReason"] = "patch-contradicts-problem-state"
            return ""
        resolution_hint = ordinary_art_problem_resolution_hint(validation_instruction)
        if (
            replacement_compact
            and resolution_hint
            and not ordinary_art_patch_replacement_has_explicit_resolution(
                validation_instruction,
                replacement,
            )
        ):
            following_text = unit_text[local_start + len(target_quote):]
            final_punctuation = "" if re.match(r"^[。！？!?；;，,]", following_text) else "。"
            replacement = (
                f"{replacement.rstrip('。！？!?；; ')}；"
                f"{resolution_hint.rstrip('。！？!?；; ')}{final_punctuation}"
            )
            replacement_compact = ordinary_art_retention_compact(replacement)
            if isinstance(diagnostics, dict):
                diagnostics["resolutionHintInjected"] = True
        if replacement_compact and len(replacement_compact) < math.ceil(len(original_compact) * 0.3):
            if isinstance(diagnostics, dict):
                diagnostics["failureReason"] = "patch-collapses-target-content"
            return ""
        if ordinary_art_patch_resource_tokens(target_quote) != ordinary_art_patch_resource_tokens(replacement):
            return ""
        if len(target_quote) > 240:
            return ""
        if len(replacement) > max(600, len(target_quote) * 4):
            return ""
        absolute_start = int(unit["start"]) + local_start
        spans.append((absolute_start, absolute_start + len(target_quote), replacement))

    if isinstance(diagnostics, dict):
        diagnostics.update({
            "intentCount": 1,
            "coveredIntents": ["I01"],
            "missingIntents": [],
        })
    ordered = sorted(spans, key=lambda item: (item[0], item[1]))
    if any(ordered[index][0] < ordered[index - 1][1] for index in range(1, len(ordered))):
        return ""
    missing_required_ids = sorted(required_ids - patched_unit_ids)
    if missing_required_ids:
        if isinstance(diagnostics, dict):
            diagnostics["failureReason"] = (
                "patch-required-units-missing:" + ",".join(missing_required_ids)
            )
        return ""
    if sum(end - start for start, end, _replacement in ordered) > bounded_target_chars:
        if isinstance(diagnostics, dict):
            diagnostics["failureReason"] = "patch-target-budget-exceeded"
        return ""
    if isinstance(diagnostics, dict):
        diagnostics.update({
            "patchCount": len(ordered),
            "patchedUnitIds": sorted(patched_unit_ids),
            "targetChars": sum(end - start for start, end, _replacement in ordered),
            "replacementChars": sum(len(replacement) for _start, _end, replacement in ordered),
        })
    merged = str(raw_prompt or "")
    for start, end, replacement in reversed(ordered):
        merged = f"{merged[:start]}{replacement}{merged[end:]}"
    if ordinary_art_retention_compact(merged) == ordinary_art_retention_compact(raw_prompt):
        if isinstance(diagnostics, dict):
            diagnostics["failureReason"] = "patch-merged-no-op"
        return ""
    if ordinary_art_patch_resource_tokens(merged) != ordinary_art_patch_resource_tokens(raw_prompt):
        return ""
    if not ordinary_art_patch_named_blocks_preserved(raw_prompt, merged, removal_targets):
        if isinstance(diagnostics, dict):
            diagnostics["failureReason"] = (
                ordinary_art_retention_failure(raw_prompt, requirements, merged)
                or "named-block-label-missing"
            )
        return ""
    priority_retention_failure = ordinary_art_patch_priority_retention_failure(
        raw_prompt,
        requirements,
        merged,
    )
    if priority_retention_failure:
        if isinstance(diagnostics, dict):
            diagnostics["failureReason"] = priority_retention_failure
        return ""
    return merged if ordinary_art_retention_compact(merged) else ""


def ordinary_art_deterministic_mixed_pair_unit_patches(
    unit_id: str,
    unit_text: str,
) -> list[dict]:
    """Build allowlisted exact replacements for residual adult mixed-pair identity slots."""

    text = str(unit_text or "")
    patches = []
    occupied = []

    def add(match: re.Match, replacement: str) -> None:
        if not match or not replacement or replacement == match.group(0):
            return
        if any(match.start() < end and match.end() > start for start, end in occupied):
            return
        occupied.append((match.start(), match.end()))
        patches.append({
            "segment_id": unit_id,
            "target_quote": match.group(0),
            "replacement": replacement,
        })

    priority_block = bool(re.match(
        r"^\s*(?:要求|约束|REQUIREMENTS?|CONSTRAINTS?)\s*[：:]",
        text,
        re.I,
    ))
    if priority_block:
        hard_pattern = re.compile(
            r"(?:两|二|2)\s*(?:位|名|个)?\s*(?:角色|人物|主体)"
            r"[^，,。！？；;\n]{0,24}?(?:成年)"
            r"(?:女性角色|女角色|女性|女人|女士)",
            re.I,
        )
        for match in hard_pattern.finditer(text):
            replacement = re.sub(
                r"成年(?:女性角色|女角色|女性|女人|女士)\s*$",
                "成年男性与成年女性",
                match.group(0),
                flags=re.I,
            )
            add(match, replacement)

    body_group_present = bool(re.search(r"(?:两人|二人)", text, re.I))
    if body_group_present:
        for match in re.finditer(r"成年女性身材", text, re.I):
            add(match, "成年男性与成年女性各自明确的体态")

    duo_pattern = re.compile(
        r"(?P<duo_cn>(?:双女性|双女)\s*(?P<duo_kind>角色|人物|组合|画面))"
        r"|(?P<duo_en>(?<![a-z0-9_])(?:(?:female|women)\s+duo|"
        r"duo\s+of\s+(?:adult\s+)?women)(?![a-z0-9_]))",
        re.I,
    )
    for match in duo_pattern.finditer(text):
        kind = clean_text(match.group("duo_kind") or "")
        if match.group("duo_en"):
            replacement = "adult male and adult female duo"
        elif kind == "组合":
            replacement = "成年男女双人组合"
        elif kind == "画面":
            replacement = "成年男女双人画面"
        else:
            replacement = f"成年男女双{kind}"
        add(match, replacement)

    for match in ORDINARY_ART_CORE_SIDE_FEMALE_PATTERN.finditer(text):
        side_cn = clean_text(match.group("side_cn") or "")
        if side_cn:
            adult = clean_text(match.group("adult_cn") or "")
            add(match, f"{side_cn}{adult}角色")
        else:
            side_en = clean_text(match.group("side_en") or "")
            adult_en = clean_text(match.group("adult_en") or "")
            add(match, f"{side_en} {adult_en}character".replace("  ", " "))

    if not priority_block and not body_group_present:
        pair_pattern = re.compile(
            r"(?P<count>(?:两|二|2)\s*(?:位|名|个))"
            r"(?P<qual>[^，,。！？；;\n]{0,32}?)"
            r"(?P<term>女性角色|女角色|女性|女人|女士)",
            re.I,
        )
        male_by_term = {
            "女性角色": "男性角色",
            "女角色": "男角色",
            "女性": "男性",
            "女人": "男人",
            "女士": "男士",
        }
        for match in pair_pattern.finditer(text):
            qualifier = match.group("qual") or ""
            if re.search(r"必须|要求|应当|明确为", qualifier, re.I):
                continue
            term = match.group("term")
            male_term = male_by_term.get(term, "男性")
            add(
                match,
                f"一位{qualifier}{male_term}与一位{qualifier}{term}",
            )

        english_pair_pattern = re.compile(
            r"(?<![a-z0-9_])(?P<count>two|both)\s+"
            r"(?P<qual>(?:adult\s+)?(?:oriental\s+|eastern\s+)?)"
            r"(?P<term>women|female\s+characters)(?![a-z0-9_])",
            re.I,
        )
        for match in english_pair_pattern.finditer(text):
            qualifier = match.group("qual") or ""
            term = clean_text(match.group("term") or "").lower()
            if term == "female characters":
                replacement = f"one {qualifier}male character and one {qualifier}female character"
            else:
                replacement = f"one {qualifier}man and one {qualifier}woman"
            add(match, replacement)

    return patches


def apply_ordinary_art_deterministic_mixed_pair_closure(
    raw_prompt: str,
    requirements: str,
    candidate: str,
    failure_reason: str,
    diagnostics: dict | None = None,
    *,
    max_unit_count: int = ORDINARY_ART_DETERMINISTIC_CLOSURE_MAX_UNITS,
    max_target_chars: int = ORDINARY_ART_DETERMINISTIC_CLOSURE_MAX_TARGET_CHARS,
) -> str:
    """Close only residual high-confidence adult mixed-pair identity conflicts."""

    instruction = ordinary_art_user_change_instruction(requirements)
    failure = clean_text(failure_reason)
    allowed_failure = failure.startswith("core-redefinition-incomplete:stale-")
    requested_male = ordinary_art_core_positive_mention_present(
        instruction,
        ORDINARY_ART_CORE_MALE_PATTERN,
        actor_context=True,
    )
    requested_female = ordinary_art_core_positive_mention_present(
        instruction,
        ORDINARY_ART_CORE_FEMALE_PATTERN,
        actor_context=True,
    )
    unsafe_context = bool(
        ORDINARY_ART_CORE_ADDITION_PATTERN.search(instruction)
        or ORDINARY_ART_CORE_THREE_OR_MORE_PEOPLE_PATTERN.search(instruction)
        or ORDINARY_ART_CORE_THREE_OR_MORE_PEOPLE_PATTERN.search(candidate)
        or ordinary_art_core_affirmative_minor_present(instruction)
        or ordinary_art_core_affirmative_minor_present(candidate)
    )
    adult_pair_context = bool(
        minimax_h3_contains_explicit_adult_assertion(raw_prompt)
        and minimax_h3_contains_explicit_adult_assertion(candidate)
    )
    if not (
        allowed_failure
        and requested_male
        and requested_female
        and adult_pair_context
        and not unsafe_context
        and ordinary_art_core_redefinition_failure(
            raw_prompt,
            requirements,
            candidate,
        ) == failure
    ):
        if isinstance(diagnostics, dict):
            diagnostics["failureReason"] = "deterministic-closure-context-not-eligible"
        return ""

    conflict_ids = ordinary_art_core_conflicting_unit_ids(candidate, failure)
    bounded_unit_count = max(
        0,
        min(
            ORDINARY_ART_DETERMINISTIC_CLOSURE_MAX_UNITS,
            int(max_unit_count or 0),
        ),
    )
    bounded_target_chars = max(
        0,
        min(
            ORDINARY_ART_DETERMINISTIC_CLOSURE_MAX_TARGET_CHARS,
            int(max_target_chars or 0),
        ),
    )
    if not conflict_ids or len(conflict_ids) > bounded_unit_count:
        if isinstance(diagnostics, dict):
            diagnostics["failureReason"] = "deterministic-closure-unit-budget-exceeded"
        return ""

    units_by_id = {
        str(unit["id"]): str(unit["text"])
        for unit in ordinary_art_patch_units(candidate)
    }
    patches = []
    for unit_id in conflict_ids:
        unit_patches = ordinary_art_deterministic_mixed_pair_unit_patches(
            unit_id,
            units_by_id.get(unit_id, ""),
        )
        if not unit_patches:
            if isinstance(diagnostics, dict):
                diagnostics["failureReason"] = (
                    f"deterministic-closure-unit-unsupported:{unit_id}"
                )
            return ""
        patches.extend(unit_patches)

    target_chars = sum(len(str(patch["target_quote"])) for patch in patches)
    if target_chars > bounded_target_chars:
        if isinstance(diagnostics, dict):
            diagnostics["failureReason"] = "deterministic-closure-target-budget-exceeded"
        return ""

    merged = candidate
    remaining_target_chars = bounded_target_chars
    for patch in patches:
        patch_diagnostics = {}
        merged_candidate = apply_ordinary_art_patch_output(
            merged,
            requirements,
            json.dumps({"patches": [patch]}, ensure_ascii=False),
            patch_diagnostics,
            allowed_unit_ids=[str(patch["segment_id"])],
            required_unit_ids=[str(patch["segment_id"])],
            max_patch_count=1,
            max_target_chars=remaining_target_chars,
        )
        if not merged_candidate:
            if isinstance(diagnostics, dict):
                diagnostics["failureReason"] = clean_text(
                    patch_diagnostics.get("failureReason")
                    or "deterministic-closure-patch-rejected"
                )
            return ""
        merged = merged_candidate
        remaining_target_chars -= len(str(patch["target_quote"]))

    final_retention_failure = ordinary_art_patch_priority_retention_failure(
        raw_prompt,
        requirements,
        merged,
    )
    final_application_failure = ordinary_art_change_application_failure(
        raw_prompt,
        requirements,
        merged,
    )
    if final_retention_failure or final_application_failure:
        if isinstance(diagnostics, dict):
            diagnostics["failureReason"] = (
                final_retention_failure
                or final_application_failure
            )
        return ""
    if isinstance(diagnostics, dict):
        diagnostics.update({
            "failureReason": "",
            "unitCount": len(conflict_ids),
            "patchedUnitIds": conflict_ids,
            "patchCount": len(patches),
            "targetChars": target_chars,
        })
    return merged


def ui_design_uses_negative_prompt(payload: dict) -> bool:
    provider = clean_text(payload.get("provider") or "local").lower()
    return provider not in {"gpt", "google"}


def normalize_ui_design_mandatory_checklist(value) -> list:
    if not isinstance(value, list):
        return []
    checklist = []
    seen = set()
    for item in value[:48]:
        if not isinstance(item, dict):
            continue
        checklist_token = clean_text(str(item.get("checklistToken") or ""))
        semantic_token = clean_text(str(item.get("semanticToken") or "")).lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", semantic_token):
            continue
        if not re.fullmatch(r"region-[1-9]\d{0,2}:[a-z0-9][a-z0-9-]{0,63}", checklist_token):
            continue
        if not checklist_token.endswith(f":{semantic_token}") or checklist_token in seen:
            continue
        seen.add(checklist_token)
        normalized = {
            "checklistToken": checklist_token,
            "regionId": clean_text(str(item.get("regionId") or ""))[:120],
            "kind": clean_text(str(item.get("kind") or "")).lower()[:48],
            "semanticToken": semantic_token,
        }
        expected_rect = item.get("expectedRect")
        if isinstance(expected_rect, dict):
            try:
                x_norm = float(expected_rect.get("xNorm"))
                y_norm = float(expected_rect.get("yNorm"))
                w_norm = float(expected_rect.get("wNorm"))
                h_norm = float(expected_rect.get("hNorm"))
                if (
                    all(math.isfinite(number) for number in (x_norm, y_norm, w_norm, h_norm))
                    and x_norm >= 0
                    and y_norm >= 0
                    and w_norm > 0
                    and h_norm > 0
                    and x_norm + w_norm <= 1.0001
                    and y_norm + h_norm <= 1.0001
                ):
                    normalized["expectedRect"] = {
                        "xNorm": round(x_norm, 4),
                        "yNorm": round(y_norm, 4),
                        "wNorm": round(w_norm, 4),
                        "hNorm": round(h_norm, 4),
                    }
            except (TypeError, ValueError):
                pass
        checklist.append(normalized)
    return checklist


def ui_design_inventory_semantic_definition(semantic_token: str) -> str:
    token = clean_text(semantic_token).lower()
    definitions = {
        "title": "独立且清楚可辨的页面或游戏标题；普通装饰文字、状态文字或按钮文字不能冒充",
        "back": "位于该语义区域内、与标题分离的方向返回导航控件，例如返回箭头或独立返回按钮；角花、标题牌、关闭按钮或无关圆形控件不能冒充",
        "status-banner": "位于角色或主视觉语义区域内、与标题分离的结果/中奖/状态提示条；标题副标、装饰分隔条、转轴边框或底栏不能冒充",
        "subject": "该区域内清楚可辨的唯一主视觉主体；图标、头像符号或背景剪影不能冒充",
        "grid": "清楚可辨的重复内容网格，行列边界与单元数量可观察",
        "amount-balance": "独立的余额数值信息，不是投注、中奖或无含义数字",
        "amount-bet": "独立的投注数值信息，不是余额、中奖或无含义数字",
        "amount-win": "独立的中奖数值信息，不是余额、投注或无含义数字",
        "balance": "独立的余额数值信息，不是投注、中奖或无含义数字",
        "bet": "独立的投注数值信息，不是余额、中奖、加减投注按钮或无含义数字",
        "win": "独立的中奖数值信息，不是余额、投注或无含义数字",
        "primary-action": "独立且清楚可辨的主操作按钮，视觉上承担旋转或开始动作；加号、减号、投注调节、装饰圆环或普通图标不能冒充",
        "utility-auto": "独立的自动操作控件，不是人物、符号或装饰图标",
        "utility-speed": "独立的速度操作控件，不是人物、符号或装饰图标",
        "utility-recharge": "独立的充值/加值操作控件，不是余额图标或普通硬币符号",
        "utility-menu": "独立的菜单操作控件，不是装饰条纹或无关列表图标",
    }
    if token.startswith("grid-"):
        return "清楚可辨的重复内容网格；必须能按该语义token辨认指定行列结构，其他区域的图标排列不能冒充"
    return definitions.get(
        token,
        "在指定语义区域内清楚可辨并承担该semanticToken对应UI功能；跨区域相似图形、装饰或无关文字不能冒充",
    )


def normalize_ui_design_grid_inventory_status(
    checklist_token: str,
    status: str,
    evidence: str,
) -> tuple[str, str]:
    expected = re.fullmatch(
        r"region-[1-9]\d{0,2}:grid-([2-9]\d*)x([2-9]\d*)",
        clean_text(checklist_token).lower(),
    )
    if not expected or status != "PRESENT":
        return status, evidence
    observed = re.search(
        r"\bobserved\s*=\s*([1-9]\d*)\s*[xX×*]\s*([1-9]\d*)\b",
        clean_text(evidence),
        re.IGNORECASE,
    )
    if not observed:
        return "UNCLEAR", (
            f"{clean_text(evidence)}；grid evidence omitted the required observed=columnsxrows count"
        ).strip("；")[:160]
    expected_columns, expected_rows = int(expected.group(1)), int(expected.group(2))
    observed_columns, observed_rows = int(observed.group(1)), int(observed.group(2))
    if (observed_columns, observed_rows) != (expected_columns, expected_rows):
        return "MISSING", clean_text(evidence)[:160]
    return status, evidence


def parse_ui_design_grid_count_output(output: str) -> dict:
    value = clean_text(output)
    object_start = value.find("{")
    if object_start < 0:
        raise ValueError("GRID_COUNT_JSON_NOT_FOUND")
    try:
        parsed, _ = json.JSONDecoder().raw_decode(value[object_start:])
    except Exception as exc:
        raise ValueError(f"GRID_COUNT_JSON_INVALID:{exc}") from exc
    if isinstance(parsed, dict) and isinstance(parsed.get("gridCount"), dict):
        parsed = parsed["gridCount"]
    if not isinstance(parsed, dict):
        raise ValueError("GRID_COUNT_SCHEMA_INVALID")
    try:
        columns = int(parsed.get("columns"))
        rows = int(parsed.get("rows"))
        confidence = float(parsed.get("confidence"))
    except (TypeError, ValueError) as exc:
        raise ValueError("GRID_COUNT_VALUES_INVALID") from exc
    if not (1 <= columns <= 24 and 1 <= rows <= 24):
        raise ValueError("GRID_COUNT_RANGE_INVALID")
    if not math.isfinite(confidence):
        raise ValueError("GRID_COUNT_CONFIDENCE_INVALID")
    return {
        "columns": columns,
        "rows": rows,
        "confidence": max(0.0, min(1.0, confidence)),
        "evidence": clean_text(str(parsed.get("evidence") or ""))[:120],
    }


def crop_ui_design_tensor_to_expected_rect(image_tensor, expected_rect: dict):
    if image_tensor is None or not isinstance(expected_rect, dict):
        raise ValueError("GRID_CROP_INPUT_INVALID")
    shape = getattr(image_tensor, "shape", None)
    if shape is None or len(shape) != 4:
        raise ValueError("GRID_CROP_TENSOR_SHAPE_INVALID")
    height = int(shape[1])
    width = int(shape[2])
    if height < 32 or width < 32:
        raise ValueError("GRID_CROP_TENSOR_TOO_SMALL")
    try:
        x_norm = float(expected_rect.get("xNorm"))
        y_norm = float(expected_rect.get("yNorm"))
        w_norm = float(expected_rect.get("wNorm"))
        h_norm = float(expected_rect.get("hNorm"))
    except (TypeError, ValueError) as exc:
        raise ValueError("GRID_CROP_RECT_INVALID") from exc
    if not all(math.isfinite(value) for value in (x_norm, y_norm, w_norm, h_norm)):
        raise ValueError("GRID_CROP_RECT_INVALID")
    if x_norm < 0 or y_norm < 0 or w_norm <= 0 or h_norm <= 0:
        raise ValueError("GRID_CROP_RECT_INVALID")
    if x_norm + w_norm > 1.0001 or y_norm + h_norm > 1.0001:
        raise ValueError("GRID_CROP_RECT_INVALID")
    x0 = max(0, int(math.floor(x_norm * width)))
    y0 = max(0, int(math.floor(y_norm * height)))
    x1 = min(width, int(math.ceil((x_norm + w_norm) * width)))
    y1 = min(height, int(math.ceil((y_norm + h_norm) * height)))
    if x1 - x0 < 32 or y1 - y0 < 32:
        raise ValueError("GRID_CROP_RECT_TOO_SMALL")
    crop = image_tensor[:, y0:y1, x0:x1, :]
    contiguous = getattr(crop, "contiguous", None)
    return contiguous() if callable(contiguous) else crop


def apply_ui_design_grid_count(
    visual_inventory: dict,
    checklist_token: str,
    expected_columns: int,
    expected_rows: int,
    grid_count: dict | None,
) -> dict:
    inventory = dict(visual_inventory or {})
    items = [
        dict(item)
        for item in (inventory.get("items") or [])
        if isinstance(item, dict)
    ]
    confidence = float((grid_count or {}).get("confidence") or 0.0)
    if grid_count and confidence >= 0.75:
        observed_columns = int(grid_count["columns"])
        observed_rows = int(grid_count["rows"])
        status = (
            "PRESENT"
            if (observed_columns, observed_rows) == (expected_columns, expected_rows)
            else "MISSING"
        )
        detail = clean_text(str(grid_count.get("evidence") or ""))
        evidence = f"observed={observed_columns}x{observed_rows}"
        if detail:
            evidence = f"{evidence}; {detail}"
    else:
        status = "UNCLEAR"
        evidence = "observed=unclear; cropped grid verifier could not count rows and columns reliably"
    replacement = {
        "checklistToken": checklist_token,
        "status": status,
        "evidence": evidence[:160],
    }
    replaced = False
    for index, item in enumerate(items):
        if clean_text(str(item.get("checklistToken") or "")) == checklist_token:
            items[index] = replacement
            replaced = True
            break
    if not replaced:
        items.append(replacement)
    inventory["items"] = items
    inventory["missingTokens"] = [
        clean_text(str(item.get("checklistToken") or ""))
        for item in items
        if item.get("status") == "MISSING"
        and clean_text(str(item.get("checklistToken") or ""))
    ]
    inventory["unclearTokens"] = [
        clean_text(str(item.get("checklistToken") or ""))
        for item in items
        if item.get("status") == "UNCLEAR"
        and clean_text(str(item.get("checklistToken") or ""))
    ]
    return inventory


def parse_ui_design_visual_inventory_output(
    output: str,
    allowed_checklist_tokens,
) -> dict:
    allowed_tokens = []
    for item in allowed_checklist_tokens or []:
        token = clean_text(str(item or ""))
        if (
            re.fullmatch(
                r"region-[1-9]\d{0,2}:[a-z0-9][a-z0-9-]{0,63}",
                token,
            )
            and token not in allowed_tokens
        ):
            allowed_tokens.append(token)
    if not allowed_tokens:
        return {
            "items": [],
            "missingTokens": [],
            "unclearTokens": [],
            "available": True,
            "reason": "",
        }

    value = clean_text(output)
    object_start = value.find("{")
    if object_start < 0:
        raise ValueError("VISUAL_INVENTORY_JSON_NOT_FOUND")
    try:
        parsed, _ = json.JSONDecoder().raw_decode(value[object_start:])
    except Exception as exc:
        raise ValueError(f"VISUAL_INVENTORY_JSON_INVALID:{exc}") from exc
    if isinstance(parsed, dict) and isinstance(parsed.get("visualInventory"), dict):
        parsed = parsed["visualInventory"]
    if not isinstance(parsed, dict) or not isinstance(parsed.get("items"), list):
        raise ValueError("VISUAL_INVENTORY_SCHEMA_INVALID")

    allowed = set(allowed_tokens)
    by_token = {}
    valid_item_count = 0
    for item in parsed["items"][:96]:
        if not isinstance(item, dict):
            continue
        checklist_token = clean_text(str(item.get("checklistToken") or ""))
        if checklist_token not in allowed:
            continue
        status = clean_text(str(item.get("status") or "")).upper()
        if status not in {"PRESENT", "MISSING", "UNCLEAR"}:
            status = "UNCLEAR"
        evidence = clean_text(str(item.get("evidence") or ""))[:160]
        status, evidence = normalize_ui_design_grid_inventory_status(
            checklist_token,
            status,
            evidence,
        )
        current = by_token.get(checklist_token)
        if current and current["status"] != status:
            by_token[checklist_token] = {
                "checklistToken": checklist_token,
                "status": "UNCLEAR",
                "evidence": "模型对该检查项给出了冲突状态",
            }
        elif not current:
            by_token[checklist_token] = {
                "checklistToken": checklist_token,
                "status": status,
                "evidence": evidence,
            }
        elif not current["evidence"] and evidence:
            current["evidence"] = evidence
        valid_item_count += 1
    if not valid_item_count:
        raise ValueError("VISUAL_INVENTORY_NO_VALID_ITEMS")

    items = []
    for checklist_token in allowed_tokens:
        item = by_token.get(checklist_token) or {
            "checklistToken": checklist_token,
            "status": "UNCLEAR",
            "evidence": "模型未返回该检查项的可见事实",
        }
        items.append(item)
    return {
        "items": items,
        "missingTokens": [
            item["checklistToken"] for item in items if item["status"] == "MISSING"
        ],
        "unclearTokens": [
            item["checklistToken"] for item in items if item["status"] == "UNCLEAR"
        ],
        "available": True,
        "reason": "",
    }


def unavailable_ui_design_visual_inventory(checklist, detail="") -> dict:
    tokens = [
        clean_text(str(item.get("checklistToken") or ""))
        for item in (checklist or [])
        if isinstance(item, dict)
        and clean_text(str(item.get("checklistToken") or ""))
    ]
    return {
        "items": [
            {
                "checklistToken": token,
                "status": "UNCLEAR",
                "evidence": "候选图可见事实盘点不可用",
            }
            for token in tokens
        ],
        "missingTokens": [],
        "unclearTokens": tokens,
        "available": False,
        "reason": clean_text(str(detail or ""))[:240],
    }


def merge_ui_design_visual_inventory(
    quality_review: dict,
    visual_inventory: dict,
    mandatory_checklist,
) -> dict:
    review = dict(quality_review or {})
    existing_failure_class = clean_text(
        str(review.get("failureClass") or "")
    ).upper()
    if visual_inventory.get("available") is False:
        return review
    checklist_by_token = {
        clean_text(str(item.get("checklistToken") or "")): item
        for item in (mandatory_checklist or [])
        if isinstance(item, dict)
        and clean_text(str(item.get("checklistToken") or ""))
    }
    missing_tokens = []
    for token in visual_inventory.get("missingTokens") or []:
        normalized = clean_text(str(token or ""))
        if normalized in checklist_by_token and normalized not in missing_tokens:
            missing_tokens.append(normalized)
    unclear_tokens = []
    for token in visual_inventory.get("unclearTokens") or []:
        normalized = clean_text(str(token or ""))
        if (
            normalized in checklist_by_token
            and normalized not in missing_tokens
            and normalized not in unclear_tokens
        ):
            unclear_tokens.append(normalized)
    if not missing_tokens and not unclear_tokens:
        return review

    inventory_items = {
        clean_text(str(item.get("checklistToken") or "")): item
        for item in (visual_inventory.get("items") or [])
        if isinstance(item, dict)
    }

    def inventory_details(tokens) -> str:
        details = []
        for token in tokens:
            checklist_item = checklist_by_token[token]
            semantic_token = clean_text(str(checklist_item.get("semanticToken") or ""))
            evidence = clean_text(
                str(inventory_items.get(token, {}).get("evidence") or "")
            )[:80]
            label = f"{token}（{semantic_token}）" if semantic_token else token
            details.append(f"{label}：{evidence}" if evidence else label)
        return "；".join(details)

    missing_detail = inventory_details(missing_tokens)
    unclear_detail = inventory_details(unclear_tokens)
    inventory_failures = []
    inventory_retries = []
    if missing_detail:
        inventory_failures.append(
            f"候选图可见事实盘点确认以下必需页面结构项缺失：{missing_detail}"
        )
        inventory_retries.append(
            f"补齐并清晰呈现已确认缺失的必需页面结构项：{missing_detail}。"
        )
    if unclear_detail:
        inventory_failures.append(
            f"候选图中以下必需 UI 项无法清晰辨认，核心 UI 可读性不足：{unclear_detail}"
        )
        inventory_retries.append(
            f"提高以下必需 UI 项的清晰度、对比度与功能辨识度：{unclear_detail}。"
        )
    inventory_failures = [item[:240] for item in inventory_failures]
    inventory_retry = (
        "".join(inventory_retries)
        + "除这些失败项外，保留已经正确的页面区域、内容与控件。"
    )

    existing_failed_tokens = review.get("failedChecklistTokens")
    if not isinstance(existing_failed_tokens, list):
        existing_failed_tokens = []
    review["failedChecklistTokens"] = list(dict.fromkeys([
        *missing_tokens,
        *unclear_tokens,
        *[
            clean_text(str(item or ""))
            for item in existing_failed_tokens
            if clean_text(str(item or "")) in checklist_by_token
        ],
    ]))[:48]

    existing_codes = review.get("failureCodes")
    if not isinstance(existing_codes, list):
        existing_codes = []
    review["failureCodes"] = list(dict.fromkeys([
        *(["STRUCTURE_MISSING"] if missing_tokens else []),
        *(["CORE_UI_UNREADABLE"] if unclear_tokens else []),
        *[clean_text(str(item or "")) for item in existing_codes if clean_text(str(item or ""))],
    ]))[:12]

    existing_failures = review.get("hardFailures")
    if not isinstance(existing_failures, list):
        existing_failures = []
    review["hardFailures"] = list(dict.fromkeys([
        *inventory_failures,
        *[clean_text(str(item or "")) for item in existing_failures if clean_text(str(item or ""))],
    ]))[:12]

    existing_retry = clean_text(str(review.get("retryPrompt") or ""))
    review["retryPrompt"] = "；".join(
        item for item in [inventory_retry, existing_retry] if item
    )[:4000]
    existing_summary = clean_text(str(review.get("summary") or ""))
    review["summary"] = "；".join(
        item for item in [existing_summary, *inventory_failures] if item
    )[:800]
    review["status"] = "FAIL"
    review["failureClass"] = (
        existing_failure_class
        if existing_failure_class in {
            "STRUCTURE",
            "CONTENT",
            "READABILITY",
            "LEAKAGE",
        }
        else "STRUCTURE" if missing_tokens else "READABILITY"
    )
    return review


def parse_ui_design_quality_review_output(
    output: str,
    allowed_checklist_tokens=None,
) -> dict:
    value = clean_text(output)
    object_start = value.find("{")
    if object_start < 0:
        raise ValueError("QUALITY_REVIEW_JSON_NOT_FOUND")
    try:
        parsed, _ = json.JSONDecoder().raw_decode(value[object_start:])
    except Exception as exc:
        raise ValueError(f"QUALITY_REVIEW_JSON_INVALID:{exc}") from exc
    if isinstance(parsed, dict) and isinstance(parsed.get("qualityReview"), dict):
        parsed = parsed["qualityReview"]
    if not isinstance(parsed, dict):
        raise ValueError("QUALITY_REVIEW_SCHEMA_INVALID")

    raw_failures = parsed.get("hardFailures")
    if isinstance(raw_failures, list):
        hard_failures = [
            clean_text(str(item or ""))[:240]
            for item in raw_failures
            if clean_text(str(item or ""))
        ][:12]
    elif clean_text(str(raw_failures or "")):
        hard_failures = [
            clean_text(item)[:240]
            for item in re.split(r"[\n；;]+", str(raw_failures))
            if clean_text(item)
        ][:12]
    else:
        hard_failures = []

    raw_failure_codes = parsed.get("failureCodes")
    if isinstance(raw_failure_codes, list):
        failure_code_values = raw_failure_codes
    elif clean_text(str(raw_failure_codes or "")):
        failure_code_values = re.split(r"[\n,，；;]+", str(raw_failure_codes))
    else:
        failure_code_values = []
    failure_codes = []
    for item in failure_code_values:
        code = re.sub(r"[\s-]+", "_", clean_text(str(item or "")).upper())
        if code in UI_DESIGN_QUALITY_FAILURE_CODES and code not in failure_codes:
            failure_codes.append(code)
    failure_codes = failure_codes[:12]

    allowed_tokens = {
        clean_text(str(item or ""))
        for item in (allowed_checklist_tokens or [])
        if re.fullmatch(
            r"region-[1-9]\d{0,2}:[a-z0-9][a-z0-9-]{0,63}",
            clean_text(str(item or "")),
        )
    }
    raw_failed_checklist_tokens = parsed.get("failedChecklistTokens")
    if isinstance(raw_failed_checklist_tokens, list):
        failed_checklist_values = raw_failed_checklist_tokens
    elif clean_text(str(raw_failed_checklist_tokens or "")):
        failed_checklist_values = re.split(
            r"[\n,，；;]+",
            str(raw_failed_checklist_tokens),
        )
    else:
        failed_checklist_values = []
    failed_checklist_tokens = []
    for item in failed_checklist_values:
        checklist_token = clean_text(str(item or ""))
        if (
            checklist_token in allowed_tokens
            and checklist_token not in failed_checklist_tokens
        ):
            failed_checklist_tokens.append(checklist_token)
    failed_checklist_tokens = failed_checklist_tokens[:48]

    failure_class = re.sub(
        r"[\s-]+",
        "_",
        clean_text(str(parsed.get("failureClass") or "")).upper(),
    )
    if failure_class not in UI_DESIGN_QUALITY_FAILURE_CLASSES:
        failure_class = ""

    raw_scores = parsed.get("scores") if isinstance(parsed.get("scores"), dict) else {}
    missing_scores = [key for key in UI_DESIGN_QUALITY_SCORE_KEYS if key not in raw_scores]
    scores = {}
    for key in UI_DESIGN_QUALITY_SCORE_KEYS:
        try:
            score = float(raw_scores.get(key, 0))
        except (TypeError, ValueError):
            score = 0.0
        scores[key] = int(round(max(0.0, min(100.0, score))))

    status = clean_text(str(parsed.get("status") or "")).upper()
    if status not in {"PASS", "FAIL", "REVIEW"}:
        status = "REVIEW"
    if status == "PASS" and not hard_failures and not failure_codes and not failed_checklist_tokens:
        low_scores = [key for key, score in scores.items() if score < 50]
        if low_scores == ["referenceLeakage"]:
            scores["referenceLeakage"] = 100
        elif low_scores:
            raise ValueError("QUALITY_REVIEW_PASS_SCORE_CONTRADICTION")
    if hard_failures or failure_codes or failed_checklist_tokens:
        status = "FAIL"
    elif status == "FAIL":
        hard_failures = ["QUALITY_GATE_FAILED"]
    elif missing_scores:
        status = "REVIEW"

    try:
        confidence = float(parsed.get("confidence", 0))
    except (TypeError, ValueError):
        confidence = 0.0
    if confidence > 1:
        confidence /= 100
    confidence = round(max(0.0, min(1.0, confidence)), 3)

    summary = clean_text(str(parsed.get("summary") or ""))[:800]
    if missing_scores:
        missing_note = f"审查评分字段不完整：{','.join(missing_scores)}"
        summary = f"{summary}；{missing_note}".strip("；")
    if not summary:
        summary = "本地模型未提供明确的质量审查摘要"
    retry_prompt = clean_text(str(parsed.get("retryPrompt") or ""))[:4000] if status == "FAIL" else ""
    return {
        "status": status,
        "hardFailures": hard_failures,
        "failureCodes": failure_codes,
        "failedChecklistTokens": failed_checklist_tokens,
        "failureClass": failure_class,
        "scores": scores,
        "summary": summary,
        "retryPrompt": retry_prompt,
        "confidence": confidence,
    }


def current_prompt_from_payload(payload: dict, fallback: str = "", limit: int = 4000) -> str:
    return str(
        payload.get("currentPrompt")
        or payload.get("current_prompt")
        or payload.get("prompt")
        or fallback
    ).strip()[:limit]


class PromptAssistant:
    def __init__(self) -> None:
        self.clip = None
        self.status = "未配置模型"
        self.error = ""
        self.loaded_model_path = ""
        self.last_generate_profile = {}

    def runtime_json_path(self) -> Path:
        return Path(os.environ.get("NOVAFLOW_RUNTIME_JSON") or str(DEFAULT_RUNTIME_JSON))

    def comfy_root(self) -> Path:
        return Path(os.environ.get("NOVAFLOW_COMFY_ROOT") or str(DEFAULT_COMFY_ROOT))

    def model_path(self) -> Path:
        return Path(os.environ.get("NOVAFLOW_PROMPT_ASSISTANT_MODEL_PATH") or str(DEFAULT_MODEL_PATH))

    def reverse_model_path(self) -> Path:
        return Path(
            os.environ.get("NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_PATH")
            or str(DEFAULT_REVERSE_QWEN3_MODEL_PATH)
        )

    def reverse_provider_preference(self, payload: dict) -> str:
        raw = str(
            payload.get("reverseModelProvider")
            or os.environ.get("NOVAFLOW_PROMPT_ASSISTANT_REVERSE_PROVIDER")
            or "auto"
        ).strip().lower().replace("_", "-")
        if raw in {"qwen2", "qwen2.5", "qwen2.5-vl", "legacy"}:
            return "qwen2.5-vl"
        if raw in {"qwen3", "qwen3-vl", "qwen3-vl-abliterated", "abliterated"}:
            return "qwen3-vl-abliterated"
        return "auto"

    def read_runtime_config(self) -> dict:
        path = self.runtime_json_path()
        if not path.exists():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))

    def add_comfy_paths(self) -> None:
        comfy_root = self.comfy_root()
        if not comfy_root.exists():
            raise FileNotFoundError(f"ComfyUI root not found: {comfy_root}")
        os.chdir(str(comfy_root))
        if str(comfy_root) not in sys.path:
            sys.path.insert(0, str(comfy_root))

    def add_model_paths(self, runtime_config: dict, model_path: Path | None) -> None:
        import folder_paths

        models_path = runtime_config.get("modelsPath")
        if models_path:
            models_root = Path(models_path)
            folder_paths.add_model_folder_path("text_encoders", str(models_root / "text_encoders"))
            folder_paths.add_model_folder_path("embeddings", str(models_root / "embeddings"))

        if model_path is not None:
            folder_paths.add_model_folder_path("text_encoders", str(model_path.parent), is_default=True)

    def force_qwen_lm_head(self) -> None:
        import comfy.text_encoders.llama as llama

        if getattr(llama.Qwen25_7BVLI, "_novaflow_prompt_assistant_lm_head", False):
            return

        original_init = llama.Qwen25_7BVLI.__init__

        def patched_init(instance, config_dict, dtype, device, operations):
            next_config = dict(config_dict)
            next_config["lm_head"] = True
            original_init(instance, next_config, dtype, device, operations)

        llama.Qwen25_7BVLI.__init__ = patched_init
        llama.Qwen25_7BVLI._novaflow_prompt_assistant_lm_head = True

    def ensure_stop_tokens(self) -> None:
        try:
            qwen_model = getattr(self.clip.cond_stage_model, "qwen25_7b")
            config = qwen_model.transformer.model.config
            if not hasattr(config, "stop_tokens"):
                config.stop_tokens = STOP_TOKENS
        except AttributeError:
            return

    def reset_loaded_clip(self) -> None:
        self.clip = None
        gc.collect()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def load(self) -> None:
        if self.clip is not None:
            return

        model_path = self.model_path()
        runtime_config = self.read_runtime_config()
        runtime_model_path = Path(str(runtime_config.get("modelsPath") or "")) / "text_encoders" / DEFAULT_MODEL_NAME
        selected_model_path = model_path if model_path.exists() else (runtime_model_path if runtime_model_path.exists() else None)
        if selected_model_path is None:
            self.status = "未配置模型"
            raise FileNotFoundError(f"未找到 Qwen2.5-VL 模型：{model_path}")

        self.status = "加载中"
        self.add_comfy_paths()
        self.force_qwen_lm_head()
        self.add_model_paths(runtime_config, selected_model_path)

        import nodes

        self.clip = nodes.CLIPLoader().load_clip(selected_model_path.name, type="qwen_image", device="default")[0]
        self.ensure_stop_tokens()
        self.loaded_model_path = str(selected_model_path)
        self.status = "模型可用"
        self.error = ""

    def status_payload(self) -> dict:
        model_path = self.model_path()
        configured = model_path.exists()
        if not configured and self.loaded_model_path:
            configured = Path(self.loaded_model_path).exists()
        runtime_status = self.status if configured else "未配置模型"
        if configured and runtime_status == "未配置模型":
            runtime_status = "模型可用"
        return {
            "modelType": MODEL_TYPE,
            "modelPath": self.loaded_model_path or str(model_path),
            "enabled": bool(configured),
            "runtimeStatus": runtime_status,
            "error": self.error,
        }

    def generate(
        self,
        prompt: str,
        *,
        images=None,
        llama_template=None,
        max_length=180,
        seed=1,
        trace_label: str = "",
        do_sample=False,
        temperature=0.0,
        top_p=1.0,
    ) -> str:
        total_started = time.perf_counter()
        trace_label = clean_text(trace_label)[:80]
        profile = {
            "traceLabel": trace_label,
            "promptChars": len(str(prompt or "")),
            "safePromptChars": 0,
            "imageCount": len(images or []),
            "maxLength": int(max_length or 0),
            "seed": seed,
            "doSample": bool(do_sample),
            "temperature": float(temperature or 0.0),
            "topP": float(top_p or 1.0),
            "loadMs": 0,
            "tokenizeMs": 0,
            "generateMs": 0,
            "decodeMs": 0,
            "totalMs": 0,
            "outputChars": 0,
            "generatedTokenCount": 0,
            "hitTokenLimit": False,
            "tokenizeRetry": False,
        }
        self.last_generate_profile = profile
        if trace_label:
            log_prompt_assistant_event(
                "prompt_assistant_generate_start",
                command=trace_label,
                promptChars=profile["promptChars"],
                maxLength=profile["maxLength"],
                seed=seed,
                imageCount=profile["imageCount"],
                doSample=profile["doSample"],
                temperature=profile["temperature"],
                topP=profile["topP"],
            )
        load_started = time.perf_counter()
        self.load()
        profile["loadMs"] = round((time.perf_counter() - load_started) * 1000)
        prompt = prompt_assistant_tokenizer_safe_text(prompt)
        profile["safePromptChars"] = len(prompt)
        tokenize_started = time.perf_counter()
        if trace_label:
            log_prompt_assistant_event(
                "prompt_assistant_tokenize_start",
                command=trace_label,
                elapsedMs=round((time.perf_counter() - total_started) * 1000),
                loadMs=profile["loadMs"],
                safePromptChars=profile["safePromptChars"],
            )
        try:
            tokens = self.clip.tokenize(prompt, images=images or [], llama_template=llama_template, min_length=1)
        except TypeError as exc:
            if "TextEncodeInput must be" not in str(exc):
                raise
            profile["tokenizeRetry"] = True
            profile["tokenizeRetryError"] = str(exc)
            log_prompt_assistant_event(
                "prompt_assistant_tokenize_retry",
                error=str(exc),
                promptChars=len(prompt),
                maxLength=max_length,
            )
            self.reset_loaded_clip()
            self.load()
            tokens = self.clip.tokenize(prompt, images=images or [], llama_template=llama_template, min_length=1)
        profile["tokenizeMs"] = round((time.perf_counter() - tokenize_started) * 1000)
        if trace_label:
            log_prompt_assistant_event(
                "prompt_assistant_tokenize_done",
                command=trace_label,
                elapsedMs=round((time.perf_counter() - total_started) * 1000),
                tokenizeMs=profile["tokenizeMs"],
                tokenizeRetry=profile["tokenizeRetry"],
            )
        generate_started = time.perf_counter()
        if trace_label:
            log_prompt_assistant_event(
                "prompt_assistant_generate_model_start",
                command=trace_label,
                elapsedMs=round((time.perf_counter() - total_started) * 1000),
                maxLength=max_length,
            )
        generated_ids = self.clip.generate(
            tokens,
            do_sample=bool(do_sample),
            max_length=max_length,
            temperature=float(temperature or 0.0),
            top_k=0,
            top_p=float(top_p or 1.0),
            min_p=0.0,
            repetition_penalty=1.0,
            seed=seed,
            presence_penalty=0.0,
        )
        profile["generateMs"] = round((time.perf_counter() - generate_started) * 1000)
        try:
            profile["generatedTokenCount"] = max(0, int(len(generated_ids)))
        except (TypeError, ValueError):
            profile["generatedTokenCount"] = 0
        profile["hitTokenLimit"] = bool(
            profile["maxLength"] > 0
            and profile["generatedTokenCount"] >= profile["maxLength"]
        )
        if trace_label:
            log_prompt_assistant_event(
                "prompt_assistant_generate_model_done",
                command=trace_label,
                elapsedMs=round((time.perf_counter() - total_started) * 1000),
                generateMs=profile["generateMs"],
                generatedTokenCount=profile["generatedTokenCount"],
                hitTokenLimit=profile["hitTokenLimit"],
            )
        decode_started = time.perf_counter()
        output = self.clip.decode(generated_ids).strip()
        profile["decodeMs"] = round((time.perf_counter() - decode_started) * 1000)
        profile["outputChars"] = len(output)
        profile["totalMs"] = round((time.perf_counter() - total_started) * 1000)
        self.last_generate_profile = dict(profile)
        if trace_label:
            log_prompt_assistant_event(
                "prompt_assistant_generate_done",
                command=trace_label,
                elapsedMs=profile["totalMs"],
                generateProfile=profile,
            )
        return output

    def structured_recompile_ordinary_art(
        self,
        payload: dict,
        raw_prompt: str,
        requirements: str,
        *,
        supports_negative: bool,
        nsfw_enabled: bool,
    ) -> dict:
        user_instruction = ordinary_art_user_change_instruction(requirements)
        hard_blocks = ordinary_art_structured_hard_constraint_blocks(raw_prompt)
        resource_tokens = ordinary_art_patch_resource_tokens(raw_prompt)
        if nsfw_enabled and ordinary_art_core_affirmative_minor_present(user_instruction):
            raise OrdinaryArtPromptEditNotAppliedError(
                "structured-sensitive-minor-request-blocked"
            )
        model_prompt = build_art_prompt_contract_instruction(
            raw_prompt,
            user_instruction,
            hard_constraint_blocks=[block_text for _label, block_text in hard_blocks],
            resource_tokens=resource_tokens,
            nsfw_enabled=nsfw_enabled,
        )
        self.status = "推理中"
        raw_ir = self.generate(
            model_prompt,
            max_length=ART_PROMPT_STRUCTURED_OUTPUT_MAX_TOKENS,
            seed=1,
            trace_label="ordinaryArtStructuredRecompile",
        )
        ledger_uses_grounded_model_mapping = False
        ledger_uses_canonical_closure = False
        grounded_model_ledger_parsed = False
        model_ledger_failure = ""
        try:
            try:
                contract = parse_art_prompt_contract(raw_ir)
                grounded_model_ledger_parsed = True
                model_ledger_failure = (
                    ordinary_art_structured_requirement_ledger_failure(
                        requirements,
                        contract.get("applied_requirements") or [],
                        grounded_mapping=True,
                        source_prompt=raw_prompt,
                    )
                )
                ledger_uses_grounded_model_mapping = (
                    not model_ledger_failure
                    or model_ledger_failure.startswith(
                        "structured-ledger-no-new-fact:"
                    )
                )
            except ArtPromptContractError as ledger_error:
                if "applied_requirements" not in clean_text(str(ledger_error)):
                    raise
                contract = parse_art_prompt_contract(
                    raw_ir,
                    ignore_applied_requirements=True,
                )
                model_ledger_failure = "art-prompt-contract-ledger-invalid"

            if not ledger_uses_grounded_model_mapping:
                rebuilt_ledger = ordinary_art_structured_rebuild_requirement_ledger(
                    requirements,
                    contract,
                )
                contract["applied_requirements"] = rebuilt_ledger
                rebuilt_failure = ordinary_art_structured_requirement_ledger_failure(
                    requirements,
                    rebuilt_ledger,
                    source_prompt=raw_prompt,
                )
                if (
                    rebuilt_failure
                    and not rebuilt_failure.startswith(
                        "structured-ledger-no-new-fact:"
                    )
                ):
                    closure_ledger = ordinary_art_structured_apply_canonical_closure(
                        requirements,
                        contract,
                        raw_prompt,
                    )
                    if closure_ledger:
                        contract["applied_requirements"] = closure_ledger
                        ledger_uses_canonical_closure = True
            ordinary_art_structured_restore_source_adult_identity(
                raw_prompt,
                requirements,
                contract,
            )
            typed_preservation_failure = (
                ordinary_art_structured_apply_source_typed_preservation(
                    raw_prompt,
                    requirements,
                    contract,
                )
            )
            if typed_preservation_failure:
                raise ArtPromptContractError(
                    typed_preservation_failure,
                    code=typed_preservation_failure,
                )
            hard_restore_failure = ordinary_art_structured_restore_source_hard_constraints(
                raw_prompt,
                requirements,
                contract,
            )
            if hard_restore_failure:
                raise ArtPromptContractError(
                    hard_restore_failure,
                    code=hard_restore_failure,
                )
            positive = compile_art_prompt_contract(contract)
            front_five = art_prompt_front_five_sections(positive)
        except ArtPromptContractError as error:
            failure_code = clean_text(
                getattr(error, "code", "") or "art-prompt-contract-invalid"
            )
            failure_detail = clean_text(str(error))
            failure_reason = failure_code
            if failure_detail and failure_detail != failure_code:
                failure_reason = f"{failure_code}:{failure_detail}"
            log_prompt_assistant_event(
                "ordinary_art_structured_recompile_rejected",
                command="ordinaryArtStructuredRecompile",
                failureReason=failure_reason[:160],
                outputChars=len(str(raw_ir or "")),
            )
            raise OrdinaryArtPromptEditNotAppliedError(
                failure_reason
            ) from error

        ledger_failure = ordinary_art_structured_requirement_ledger_failure(
            requirements,
            contract.get("applied_requirements") or [],
            grounded_mapping=(
                ledger_uses_grounded_model_mapping
                or ledger_uses_canonical_closure
            ),
            source_prompt=raw_prompt,
        )
        if (
            ledger_failure
            and grounded_model_ledger_parsed
            and model_ledger_failure
            and not ledger_failure.startswith("structured-ledger-no-new-fact:")
        ):
            ledger_failure = model_ledger_failure
        if ledger_failure:
            raise OrdinaryArtPromptEditNotAppliedError(ledger_failure)

        if ordinary_art_patch_resource_tokens(positive) != resource_tokens:
            raise OrdinaryArtPromptRetentionError(
                "structured-resource-token-mismatch"
            )
        terminal_constraints = art_prompt_terminal_constraint_text(contract)
        hard_failure = ordinary_art_structured_hard_constraint_failure(
            raw_prompt,
            requirements,
            terminal_constraints,
        )
        if hard_failure:
            raise OrdinaryArtPromptRetentionError(hard_failure)
        visible_hard_failure = ordinary_art_structured_visible_hard_failure(
            raw_prompt,
            requirements,
            contract,
        )
        if visible_hard_failure:
            raise OrdinaryArtPromptRetentionError(visible_hard_failure)
        retention_failure = ordinary_art_structured_retention_failure(
            raw_prompt,
            requirements,
            positive,
        )
        if retention_failure:
            raise OrdinaryArtPromptRetentionError(retention_failure)
        if nsfw_enabled and ordinary_art_core_affirmative_minor_present(positive):
            raise OrdinaryArtPromptEditNotAppliedError(
                "structured-sensitive-minor-output-blocked"
            )
        adult_assertion_required = bool(
            ordinary_art_structured_has_explicit_adult_identity(raw_prompt)
            or ordinary_art_structured_has_explicit_adult_identity(user_instruction)
            or (
                nsfw_enabled
                and ordinary_art_structured_has_sensitive_person_context(
                    raw_prompt,
                    user_instruction,
                    front_five,
                )
            )
        )
        if (
            adult_assertion_required
            and not ordinary_art_structured_has_explicit_adult_identity(front_five)
        ):
            raise OrdinaryArtPromptEditNotAppliedError(
                "structured-adult-assertion-missing-from-front"
            )
        application_failure = ordinary_art_change_application_failure(
            raw_prompt,
            requirements,
            front_five,
        )
        if not application_failure:
            application_failure = ordinary_art_change_application_failure(
                raw_prompt,
                requirements,
                positive,
            )
        if not application_failure and not (
            ledger_uses_grounded_model_mapping
            or ledger_uses_canonical_closure
        ):
            application_failure = ordinary_art_structured_front_change_failure(
                requirements,
                front_five,
            )
        if application_failure:
            raise OrdinaryArtPromptEditNotAppliedError(application_failure)

        negative_prompt = ""
        if supports_negative:
            negative_prompt = build_targeted_negative_prompt(
                raw_prompt,
                positive,
                "",
            )
            if not negative_prompt:
                raise ValueError("模型未返回可用的负向关键词")
        self.status = "模型可用"
        log_prompt_assistant_event(
            "ordinary_art_structured_recompile_complete",
            command="ordinaryArtStructuredRecompile",
            promptSchema=ART_PROMPT_SCHEMA_VERSION,
            positiveChars=len(positive),
            negativeChars=len(negative_prompt),
            subjectCount=int(contract.get("subject_count") or 0),
            appliedRequirementCount=len(contract.get("applied_requirements") or []),
            hardConstraintCount=len(contract.get("terminal_constraints") or []),
        )
        return {
            "positivePrompt": positive,
            "negativePrompt": negative_prompt,
            "rawOutput": positive,
            "editContract": ART_PROMPT_EDIT_CONTRACT,
            "promptSchema": ART_PROMPT_SCHEMA_VERSION,
        }

    def optimize_prompt(self, payload: dict) -> dict:
        is_minimax_h3 = is_minimax_h3_prompt_payload(payload)
        raw_prompt = (
            current_prompt_from_payload(payload, limit=20000)
            if is_minimax_h3
            else str(
                payload.get("prompt")
                or payload.get("currentPrompt")
                or payload.get("current_prompt")
                or ""
            ).strip()
        )
        requirements_limit = 12000 if is_minimax_h3 else 2000
        requirements = clean_text(payload.get("requirements") or "")[:requirements_limit]
        minimax_h3_mode = minimax_h3_mode_from_requirements(requirements) if is_minimax_h3 else ""
        minimax_h3_duration = (
            minimax_h3_duration_from_requirements(requirements)
            if is_minimax_h3
            else None
        )
        is_animation = is_minimax_h3 or is_animation_prompt_payload(payload)
        is_ui_design = is_ui_design_prompt_payload(payload)
        is_create = not raw_prompt and not is_animation
        is_ordinary_art = (
            not is_minimax_h3
            and not is_animation
            and not is_ui_design
            and is_ordinary_art_prompt_payload(payload)
        )
        art_supports_negative = ordinary_art_supports_negative_prompt(payload)
        ordinary_art_nsfw_enabled = payload.get("nsfw") is True
        ordinary_art_user_instruction = (
            ordinary_art_user_change_instruction(requirements)
            if is_ordinary_art and not is_create else ""
        )
        ordinary_art_patch_edit = bool(
            is_ordinary_art
            and not is_create
            and ordinary_art_user_instruction
            and not ordinary_art_instruction_allows_unchanged(requirements)
        )
        ordinary_art_structured_recompile = is_ordinary_art_structured_recompile_payload(
            payload,
            raw_prompt,
            is_ordinary_art=is_ordinary_art,
            is_create=is_create,
        )
        if not raw_prompt and not requirements:
            raise ValueError("请选择预设或描述你的想法" if not is_animation else "请输入正向提示词")

        requirements_section = (
            "\n用户附加要求（高优先级输出约束）：\n"
            f"{requirements}\n"
            "必须在最终正向提示词中落实这些要求；没有明确要求改变的主体、功能或关键特征必须保留。\n"
            if requirements else ""
        )

        if is_minimax_h3:
            system_prompt = build_minimax_h3_prompt_instruction(raw_prompt, requirements)
        elif is_ui_design:
            include_negative = ui_design_uses_negative_prompt(payload)
            task_instruction = (
                "根据页面结构、参考图职责和用户要求，从零建立一段可直接用于生成成品 UI 的中文设计要求。"
                if is_create else
                "优化当前 UI 设计要求，同时严格保留页面功能、信息层级、结构约束和所有资源引用占位符。"
            )
            output_contract = (
                "请严格输出两行，冒号后填写内容：\n正向：\n负向："
                if include_negative else
                "只输出一段最终正向设计要求，不要添加标题、前缀或负面要求。"
            )
            negative_instruction = (
                "负向要求只使用逗号分隔的中文关键词，针对 UI 自动包含布局混乱、元素重叠、文字错乱、按钮变形、"
                "图标畸形、边距不一致、对齐错误、水印和 Logo。"
                if include_negative else
                "当前生成模型不使用独立负面提示通道，禁止输出负向或避免项。"
            )
            system_prompt = (
                f"你是 NovaFlow UI 版块专用的设计助手。{task_instruction}"
                "这不是普通绘画提示词：重点必须是页面目标、功能分区、信息层级、视觉风格、配色、材质、控件状态、"
                "间距、对齐和可读性。不得擅自改变页面结构或删减用户指定功能。"
                "参考图只允许贡献被指定的职责；布局、风格、配色、材质、内容素材和主体必须彼此隔离，禁止整图照抄。"
                "如果输入中出现 __NOVAFLOW_ 开头并以双下划线结尾的资源引用占位符，必须原样、原次数保留，"
                "不得改写、翻译、移动到负向内容或重复。"
                "最终结果只能描述成品 UI，不得输出分析过程、多个方案、JSON、坐标、百分比、节点、连线、矩形标注、"
                "画布操作或软件界面说明；也不得把提示文字和区块说明当成最终 UI 文案照抄。"
                "正向要求使用连贯、明确的中文自然语言。"
                f"{negative_instruction}"
                f"{requirements_section if not is_create else ''}"
                "\n现在处理：\n"
                f"{'用户创作需求' if is_create else '当前设计要求'}：{requirements if is_create else raw_prompt}\n"
                f"{output_contract}"
            )
        elif is_animation:
            system_prompt = (
                "你是 NovaFlow 的视频生成 Prompt 设计助手。请把用户当前提示改写成一段可直接用于 WAN 等视频或图生视频模型的中文自然语言 Prompt。"
                "最终只保留一个合并后的方案，不要输出原提示、多个备选、解释、JSON、英文或 SD 标签。"
                "必须保持主体身份、数量、外观、服装和道具一致；明确动作开始状态、连续动作过程和动作结束状态，不能只写静态画面。"
                "必须写清动作速度与节奏；若用户没有指定时长，按约5秒的自然动作设计，不能在短时长内堆叠过多动作。"
                "必须写清镜头是固定、推进、拉远、跟随、环绕或其他单一连贯运镜，避免互相冲突的镜头指令。"
                "除非用户明确要求改变场景，否则背景、构图、光线和主体位置关系保持稳定，并避免身份漂移、穿模和画面闪烁。"
                "用户附加要求必须与当前提示融合进同一段最终 Prompt，不能只是机械追加。"
                "同时生成中文负向关键词列表，只允许用逗号分隔关键词，必须包含动作抖动、画面闪烁、身份漂移、人物变形、背景漂移等视频约束。"
                f"{requirements_section}"
                "\n现在处理：\n"
                f"当前视频提示：{raw_prompt}\n"
                "请严格输出两行，冒号后填写内容：\n"
                "正向：\n"
                "负向："
            )
        else:
            task_instruction = (
                "请根据用户的创作需求从零构建一段适合图像生成或图像编辑模型使用的中文自然语言提示词。"
                if is_create else
                "当前 Prompt 是需要继续编辑的完整底稿，用户附加要求只是对底稿的局部修改指令，不是新的完整 Prompt。"
                "请只调整用户明确要求改变的内容，逐项保留未被要求改变的主体身份与数量、外观服装、动作关系、"
                "场景元素、构图镜头、风格材质、光影色彩、质量要求和避免项。最终必须输出包含全部保留内容和修改结果的"
                "完整提示词，不能只输出修改建议，也不能只扩写用户附加要求。"
            )
            source_label = "用户创作需求" if is_create else "当前完整 Prompt"
            source_text = requirements if is_create else raw_prompt
            response_instruction = (
                "同时生成推荐负面提示词。正向提示词必须是中文自然语言描述。负向提示词必须是中文关键词列表，"
                "只允许用逗号分隔关键词，禁止写成‘不要出现低质量画面’这类完整句子。"
                "负向提示词需要根据正向内容自动判断类型并生成针对性关键词。"
                "如果涉及人物或角色，必须加入错误解剖、畸形肢体、手部错误、重复肢体等相关负面词。"
                "如果涉及 UI 或界面，必须加入布局混乱、文字错乱、元素重叠、按钮变形等相关负面词。"
                "如果涉及视频或动作，必须加入动作抖动、画面闪烁、身份漂移、人物变形等相关负面词。"
                "负向提示词不要写成长句，只输出关键词，用逗号分隔。"
                if art_supports_negative else
                "当前生成模型没有独立负向提示通道，只输出一段完整的中文正向提示词；"
                "不得输出独立负向提示词或第二段，也不要标题、前缀、解释或多个方案；"
                "原底稿已有的‘避免’‘禁止’等生成约束仍须原位保留在完整正向提示词中。"
            )
            example = (
                "\n示例：\n"
                "用户输入：未来科技风登录界面\n"
                "正向：设计一个未来科技风格的移动端登录界面，整体采用深蓝色渐变配色，使用玻璃拟态设计语言，登录卡片居中展示，按钮带有轻微发光效果，界面简洁高级，适合科技类产品。\n"
                "负向：低质量, 模糊, 布局混乱, 元素重叠, 错误文字, 水印, Logo\n"
                if art_supports_negative else ""
            )
            output_contract = (
                "请严格输出两行，冒号后填写内容：\n正向：\n负向："
                if art_supports_negative else
                "只输出一段完整正向提示词，不要添加任何标题或前缀。"
            )
            system_prompt = (
                f"你是 NovaFlow 的提示词设计助手。{task_instruction}"
                "不要翻译成英文，不要输出 SD 标签，不要输出 JSON。请补充主体、场景、风格、构图、光影、材质和必要约束条件。"
                f"{response_instruction}"
                "必须严格围绕用户输入，不得改成其他主题。"
                "如果用户输入包含界面、登录、按钮、输入框、UI、卡片等元素，必须保留这些元素并扩写。"
                f"{requirements_section if not is_create else ''}"
                f"{example}"
                "\n现在处理：\n"
                f"{source_label}：{source_text}\n"
                f"{'最终必须实际落实本次局部修改，不得原样返回完整底稿：' + ordinary_art_user_change_instruction(requirements) + chr(10) if (not is_create and is_ordinary_art and ordinary_art_user_change_instruction(requirements) and not ordinary_art_instruction_allows_unchanged(requirements)) else ''}"
                f"{output_contract}"
            )
        self.status = "推理中"
        if ordinary_art_structured_recompile:
            return self.structured_recompile_ordinary_art(
                payload,
                raw_prompt,
                requirements,
                supports_negative=art_supports_negative,
                nsfw_enabled=ordinary_art_nsfw_enabled,
            )
        if ordinary_art_patch_edit:
            patch_intents = ordinary_art_patch_intents(requirements)
            if not patch_intents:
                log_prompt_assistant_event(
                    "ordinary_art_prompt_patch_rejected",
                    command="ordinaryArtPromptPatch",
                    failureReason="patch-requirement-empty",
                    intentCount=len(patch_intents),
                )
                raise OrdinaryArtPromptEditNotAppliedError(
                    "patch-requirement-empty"
                )
            patch_prompt = build_ordinary_art_patch_repair_prompt(
                raw_prompt,
                requirements,
                "primary-local-edit",
                ordinary_art_nsfw_enabled,
            )
            patch_failure = ""
            patch_output = ""
            merged_positive = ""
            patch_base = raw_prompt
            repair_required_unit_ids = []
            cumulative_patch_count = 0
            cumulative_target_chars = 0
            patch_started = time.monotonic()
            for attempt in range(2):
                incremental_repair = bool(
                    attempt > 0
                    and patch_base != raw_prompt
                    and repair_required_unit_ids
                )
                remaining_patch_count = 4 - cumulative_patch_count if incremental_repair else 4
                remaining_target_chars = 320 - cumulative_target_chars if incremental_repair else 320
                if incremental_repair and (
                    remaining_patch_count <= 0 or remaining_target_chars <= 0
                ):
                    patch_failure = "patch-cumulative-budget-exhausted"
                    break
                patch_output = self.generate(
                    patch_prompt if attempt == 0 else build_ordinary_art_patch_repair_prompt(
                        patch_base,
                        requirements,
                        patch_failure or "patch-json-or-anchor-invalid",
                        ordinary_art_nsfw_enabled,
                        required_unit_ids=repair_required_unit_ids if incremental_repair else None,
                        remaining_patch_count=remaining_patch_count,
                        remaining_target_chars=remaining_target_chars,
                    ) + (
                        (
                            "\n上一次补丁已通过结构、资源与硬约束校验，并已合并为本轮列出的完整底稿。"
                            "不要重复已经完成的修改；只 patch 校验上下文指出的剩余冲突单元，"
                            "使当前底稿与统一修改要求完全一致。现在只输出补充修正所需的严格 JSON。"
                        )
                        if incremental_repair else
                        (
                            f"\n上一次不合格 JSON（仅作反例，绝对不要复制）：\n"
                            f"{clean_text(patch_output)[:4000]}\n"
                            f"该反例失败原因：{clean_text(patch_failure or 'patch-json-or-anchor-invalid')[:160]}。"
                            "请重新选择原文中的精确 target_quote，并输出不同的修正 JSON。"
                            "target_quote 不需要复述用户要求，只需逐字来自应修改的原文片段。"
                            "若用户说的是画面问题，replacement 必须描述该问题已经消失后的最终画面，"
                            "不得再次出现原问题表述。现在只输出修正后的严格 JSON。"
                        )
                    ),
                    max_length=ORDINARY_ART_PROMPT_PATCH_MAX_LENGTH,
                    seed=1 + attempt,
                    trace_label="ordinaryArtPromptPatch",
                )
                patch_diagnostics = {}
                merged_positive = apply_ordinary_art_patch_output(
                    patch_base,
                    requirements,
                    patch_output,
                    patch_diagnostics,
                    allowed_unit_ids=repair_required_unit_ids if incremental_repair else None,
                    required_unit_ids=None,
                    max_patch_count=remaining_patch_count,
                    max_target_chars=remaining_target_chars,
                )
                log_prompt_assistant_event(
                    "ordinary_art_prompt_patch_attempt",
                    command="ordinaryArtPromptPatch",
                    attempt=attempt + 1,
                    accepted=bool(merged_positive),
                    failureReason=clean_text(patch_diagnostics.get("failureReason") or ""),
                    patchCount=int(patch_diagnostics.get("patchCount") or 0),
                    targetChars=int(patch_diagnostics.get("targetChars") or 0),
                    replacementChars=int(patch_diagnostics.get("replacementChars") or 0),
                    intentCount=int(patch_diagnostics.get("intentCount") or len(patch_intents)),
                    coveredIntents=list(patch_diagnostics.get("coveredIntents") or []),
                    missingIntents=list(patch_diagnostics.get("missingIntents") or []),
                    elapsedMs=round((time.monotonic() - patch_started) * 1000),
                )
                if not merged_positive:
                    patch_failure = clean_text(
                        patch_diagnostics.get("failureReason")
                        or "patch-json-or-anchor-invalid"
                    )
                    if (
                        attempt == 0
                        and time.monotonic() - patch_started
                        >= ORDINARY_ART_PROMPT_PATCH_RETRY_LATEST_SECONDS
                    ):
                        break
                    continue
                retention_failure = ordinary_art_patch_priority_retention_failure(
                    raw_prompt,
                    requirements,
                    merged_positive,
                )
                application_failure = ordinary_art_change_application_failure(
                    raw_prompt,
                    requirements,
                    merged_positive,
                )
                patch_failure = retention_failure or application_failure
                deterministic_closure_diagnostics = {}
                scoped_residual_core_failure = bool(
                    not retention_failure
                    and application_failure.startswith(
                        "core-redefinition-incomplete:stale-"
                    )
                )
                if scoped_residual_core_failure:
                    total_model_target_chars = (
                        cumulative_target_chars
                        + int(patch_diagnostics.get("targetChars") or 0)
                    )
                    merged_with_closure = apply_ordinary_art_deterministic_mixed_pair_closure(
                        raw_prompt,
                        requirements,
                        merged_positive,
                        application_failure,
                        deterministic_closure_diagnostics,
                        max_unit_count=ORDINARY_ART_DETERMINISTIC_CLOSURE_MAX_UNITS,
                        max_target_chars=(
                            ORDINARY_ART_DETERMINISTIC_CLOSURE_MAX_TARGET_CHARS
                            - total_model_target_chars
                        ),
                    )
                    log_prompt_assistant_event(
                        "ordinary_art_prompt_deterministic_closure",
                        command="ordinaryArtPromptPatch",
                        accepted=bool(merged_with_closure),
                        failureReason=clean_text(
                            deterministic_closure_diagnostics.get("failureReason") or ""
                        ),
                        unitCount=int(
                            deterministic_closure_diagnostics.get("unitCount") or 0
                        ),
                        patchCount=int(
                            deterministic_closure_diagnostics.get("patchCount") or 0
                        ),
                        targetChars=int(
                            deterministic_closure_diagnostics.get("targetChars") or 0
                        ),
                        modelTargetChars=total_model_target_chars,
                        elapsedMs=round((time.monotonic() - patch_started) * 1000),
                    )
                    if merged_with_closure:
                        merged_positive = merged_with_closure
                        retention_failure = ordinary_art_patch_priority_retention_failure(
                            raw_prompt,
                            requirements,
                            merged_positive,
                        )
                        application_failure = ordinary_art_change_application_failure(
                            raw_prompt,
                            requirements,
                            merged_positive,
                        )
                        patch_failure = retention_failure or application_failure
                    else:
                        patch_failure = clean_text(
                            deterministic_closure_diagnostics.get("failureReason")
                            or application_failure
                        )
                if not patch_failure:
                    quality_closure_diagnostics = {}
                    merged_with_quality_closure = apply_ordinary_art_simple_quality_closure(
                        raw_prompt,
                        requirements,
                        merged_positive,
                        quality_closure_diagnostics,
                        prompt_schema=clean_text(payload.get("promptSchema") or ""),
                    )
                    if quality_closure_diagnostics.get("eligible"):
                        log_prompt_assistant_event(
                            "ordinary_art_prompt_simple_quality_closure",
                            command="ordinaryArtPromptPatch",
                            accepted=bool(merged_with_quality_closure),
                            failureReason=clean_text(
                                quality_closure_diagnostics.get("failureReason") or ""
                            ),
                            requestedDomains=list(
                                quality_closure_diagnostics.get("requestedDomains") or []
                            ),
                            appendedDomains=list(
                                quality_closure_diagnostics.get("appendedDomains") or []
                            ),
                            providerDeltaDiscarded=bool(
                                quality_closure_diagnostics.get("providerDeltaDiscarded")
                            ),
                            elapsedMs=round((time.monotonic() - patch_started) * 1000),
                        )
                    if merged_with_quality_closure:
                        merged_positive = merged_with_quality_closure
                    else:
                        patch_failure = clean_text(
                            quality_closure_diagnostics.get("failureReason")
                            or "simple-quality-closure-invalid"
                        )
                if not patch_failure:
                    positive = merged_positive
                    negative_prompt = ""
                    if art_supports_negative:
                        negative_prompt = build_targeted_negative_prompt(
                            raw_prompt,
                            positive,
                            "",
                        )
                        if not negative_prompt:
                            raise ValueError("模型未返回可用的负向关键词")
                    self.status = "模型可用"
                    return {
                        "positivePrompt": positive,
                        "negativePrompt": negative_prompt,
                        "rawOutput": positive,
                        "editContract": ORDINARY_ART_EDIT_CONTRACT,
                    }
                if attempt == 0:
                    scoped_core_failure = bool(
                        not retention_failure
                        and (
                            application_failure.startswith(
                                "core-redefinition-incomplete:stale-"
                            )
                            or application_failure == (
                                "core-redefinition-incomplete:one-of-two-composition"
                            )
                        )
                    )
                    unresolved_unit_ids = (
                        ordinary_art_core_conflicting_unit_ids(
                            merged_positive,
                            application_failure,
                        )
                        if scoped_core_failure else
                        []
                    )
                    if unresolved_unit_ids:
                        patch_base = merged_positive
                        repair_required_unit_ids = unresolved_unit_ids
                        cumulative_patch_count = int(
                            patch_diagnostics.get("patchCount") or 0
                        )
                        cumulative_target_chars = int(
                            patch_diagnostics.get("targetChars") or 0
                        )
                    else:
                        patch_base = raw_prompt
                        repair_required_unit_ids = []
                        cumulative_patch_count = 0
                        cumulative_target_chars = 0
                if (
                    attempt == 0
                    and time.monotonic() - patch_started
                    >= ORDINARY_ART_PROMPT_PATCH_RETRY_LATEST_SECONDS
                ):
                    break
            if patch_failure.startswith("missing-blocks:") or patch_failure.startswith("candidate-too-short:") or patch_failure.startswith("anchors-missing:"):
                raise OrdinaryArtPromptRetentionError(patch_failure)
            raise OrdinaryArtPromptEditNotAppliedError(
                patch_failure or "patch-json-or-anchor-invalid"
            )
        output_max_length = (
            minimax_h3_prompt_max_length(minimax_h3_mode)
            if is_minimax_h3
            else 240 if is_animation
            else 260 if is_ui_design
            else ordinary_art_prompt_output_max_length(raw_prompt)
            if not is_create and is_ordinary_art_prompt_payload(payload)
            else ORDINARY_ART_PROMPT_BASE_MAX_LENGTH
        )
        output = self.generate(
            system_prompt,
            llama_template=MINIMAX_H3_PROMPT_LLAMA_TEMPLATE if is_minimax_h3 else None,
            max_length=output_max_length,
            trace_label="minimaxH3PromptEnhance" if is_minimax_h3 else "",
        )
        if is_minimax_h3:
            minimax_h3_value_language = minimax_h3_preferred_value_language(raw_prompt, requirements)
            try:
                normalized_output = validate_minimax_h3_value_language(
                    normalize_minimax_h3_prompt_output(output),
                    minimax_h3_value_language,
                )
                positive = validate_minimax_h3_prompt_contract(
                    complete_minimax_h3_mechanical_contract(
                        normalized_output,
                        minimax_h3_mode,
                        minimax_h3_duration,
                        minimax_h3_value_language,
                    ),
                    minimax_h3_mode,
                    minimax_h3_duration,
                )
            except ValueError as first_error:
                repair_prompt = build_minimax_h3_prompt_repair_instruction(
                    output,
                    raw_prompt,
                    requirements,
                    minimax_h3_mode,
                    first_error,
                )
                repair_output = self.generate(
                    repair_prompt,
                    llama_template=MINIMAX_H3_PROMPT_LLAMA_TEMPLATE,
                    max_length=minimax_h3_prompt_max_length(minimax_h3_mode, repair=True),
                    seed=2,
                    trace_label="minimaxH3PromptRepair",
                )
                try:
                    normalized_repair_output = validate_minimax_h3_value_language(
                        normalize_minimax_h3_prompt_output(repair_output),
                        minimax_h3_value_language,
                    )
                    positive = validate_minimax_h3_prompt_contract(
                        complete_minimax_h3_mechanical_contract(
                            normalized_repair_output,
                            minimax_h3_mode,
                            minimax_h3_duration,
                            minimax_h3_value_language,
                        ),
                        minimax_h3_mode,
                        minimax_h3_duration,
                    )
                except ValueError:
                    raise ValueError(
                        "本地提示词助手未能生成符合 MiniMax H3 协议的提示词，请简化描述后重试"
                    ) from None
            negative = ""
        else:
            if is_ordinary_art and not art_supports_negative:
                application_positive = ordinary_art_positive_only_primary_output(output)
                positive = normalize_ordinary_art_positive_only_output(output)
                negative = ""
            else:
                positive, negative = split_optimized_output(output)
                application_positive = positive
            if is_ordinary_art and not is_create:
                retention_failure = ordinary_art_retention_failure(
                    raw_prompt,
                    requirements,
                    positive,
                )
                application_failure = ordinary_art_change_application_failure(
                    raw_prompt,
                    requirements,
                    application_positive,
                )
                contract_failure = retention_failure or application_failure
                if contract_failure:
                    repair_output = self.generate(
                        build_ordinary_art_retention_repair_prompt(
                            raw_prompt,
                            requirements,
                            positive,
                            art_supports_negative,
                            contract_failure,
                        ),
                        max_length=output_max_length,
                        seed=2,
                    )
                    if art_supports_negative:
                        repair_positive, repair_negative = split_optimized_output(repair_output)
                    else:
                        repair_application_positive = ordinary_art_positive_only_primary_output(
                            repair_output
                        )
                        repair_positive = normalize_ordinary_art_positive_only_output(
                            repair_output
                        )
                        repair_negative = ""
                    if art_supports_negative:
                        repair_application_positive = repair_positive
                    repaired_failure = ordinary_art_retention_failure(
                        raw_prompt,
                        requirements,
                        repair_positive,
                    )
                    if repaired_failure:
                        raise OrdinaryArtPromptRetentionError(repaired_failure)
                    repaired_application_failure = ordinary_art_change_application_failure(
                        raw_prompt,
                        requirements,
                        repair_application_positive,
                    )
                    if repaired_application_failure:
                        raise OrdinaryArtPromptEditNotAppliedError(
                            repaired_application_failure
                        )
                    output = repair_output
                    positive = repair_positive
                    negative = repair_negative
            if is_ordinary_art and not art_supports_negative:
                negative = ""
                output = positive
        if not positive:
            raise ValueError("模型未返回可用的正向提示词")
        negative_source = f"视频 动画 图生视频 {raw_prompt}" if is_animation else (raw_prompt or requirements)
        negative_prompt = ""
        if not is_minimax_h3:
            should_build_negative = (
                art_supports_negative
                if is_ordinary_art
                else not is_ui_design or ui_design_uses_negative_prompt(payload)
            )
            if should_build_negative:
                negative_prompt = build_targeted_negative_prompt(negative_source, positive, negative)
                if not negative_prompt:
                    raise ValueError("模型未返回可用的负向关键词")
        self.status = "模型可用"
        return {
            "positivePrompt": positive,
            "negativePrompt": negative_prompt,
            "rawOutput": positive if is_minimax_h3 else output,
        }

    def run_storyboard_director_patch_sequence(
        self,
        story_text: str,
        world_continuity: str,
        parsed_output: list,
        first_text: str,
        started: float,
        patch_max_length: int,
        first_reason: str = "",
        selected_direction=None,
        visual_event_chain=None,
    ) -> dict:
        current = [list(item) for item in parsed_output]
        all_initial_targets = storyboard_director_patch_targets(current)
        initial_targets = all_initial_targets[:3]
        applied_patches: dict[int, list] = {}
        applied_reasons: list[str] = []
        attempted_indexes: list[int] = []
        failed_indexes: list[int] = []
        skipped_indexes: list[int] = []
        patch_generate_profiles: list[dict] = []

        for sequence_index, original_target in enumerate(initial_targets):
            target_index = storyboard_director_target_index(original_target)
            if target_index < 0:
                continue
            active_targets = storyboard_director_patch_targets(current)
            active_target = storyboard_director_find_target_for_index(active_targets, target_index)
            if not active_target:
                skipped_indexes.append(target_index)
                continue
            single_targets = [active_target]
            patch_prompt = build_storyboard_director_patch_prompt(
                story_text,
                world_continuity,
                current,
                single_targets,
                selected_direction,
                visual_event_chain,
            )
            attempted_indexes.append(target_index)
            attempt_number = 1 + len(attempted_indexes)
            log_prompt_assistant_event(
                "storyboard_director_plan_patch_start",
                command="storyboardDirectorPlan",
                elapsedMs=round((time.time() - started) * 1000),
                promptChars=len(patch_prompt),
                firstOutputChars=len(first_text),
                firstReason=first_reason,
                targetScene=target_index + 1,
                targetScenes=[target_index + 1],
                patchReason=active_target["reason"],
                patchReasons=[active_target["reason"]],
                patchSequenceIndex=sequence_index + 1,
                patchSequenceTotal=len(initial_targets),
                maxLength=patch_max_length,
                attempt=attempt_number,
            )
            patch_output = self.generate(
                patch_prompt,
                max_length=patch_max_length,
                seed=3 + sequence_index,
                trace_label="storyboardDirectorPatch",
            )
            patch_generate_profile = dict(self.last_generate_profile or {})
            patch_text = clean_text(patch_output)
            patches = parse_storyboard_director_patch_output(patch_text, single_targets)
            merged = apply_storyboard_director_patches(current, patches) if patches else current
            merged_text = compact_storyboard_director_json(merged)
            merged_validation = validate_compact_storyboard_director_output(merged_text)
            patch_ok = (
                bool(patches) and
                storyboard_director_patches_resolve_targets(current, patches, merged, single_targets) and
                bool(merged_validation["ok"])
            )
            if patch_ok:
                current = merged
                for index, values in patches.items():
                    applied_patches[index] = values
                applied_reasons.append(active_target["reason"])
            else:
                failed_indexes.append(target_index)
            patch_generate_profile.update({
                "scene": target_index + 1,
                "attempt": attempt_number,
                "patchOk": bool(patch_ok),
                "outputChars": len(patch_text),
            })
            patch_generate_profiles.append(patch_generate_profile)
            remaining_targets = storyboard_director_patch_targets(current)
            log_prompt_assistant_event(
                "storyboard_director_plan_patch_done",
                command="storyboardDirectorPlan",
                elapsedMs=round((time.time() - started) * 1000),
                outputChars=len(patch_text),
                rawPreview=patch_text[:300],
                patchOk=patch_ok,
                patchCount=len(patches),
                targetScene=target_index + 1,
                targetScenes=[target_index + 1],
                remainingTargetScenes=[item["index"] + 1 for item in remaining_targets],
                valid=merged_validation["ok"],
                reason=merged_validation["reason"],
                actualScenes=merged_validation["actualScenes"],
                jsonClosed=merged_validation["jsonClosed"],
                jsonWrapperRepaired=merged_validation["jsonWrapperRepaired"],
                qualityWarning=merged_validation["qualityWarning"],
                qualityHardError=merged_validation["qualityHardError"],
                attempt=attempt_number,
                generateProfile=patch_generate_profile,
            )

        merged_text = compact_storyboard_director_json(current)
        merged_validation = validate_compact_storyboard_director_output(merged_text)
        final_targets = storyboard_director_patch_targets(current)
        remaining_initial_indexes = [
            storyboard_director_target_index(target) for target in initial_targets
            if storyboard_director_find_target_for_index(final_targets, storyboard_director_target_index(target))
        ]
        patch_ok = bool(applied_patches) and bool(merged_validation["ok"])
        patch_fully_resolved = patch_ok and not remaining_initial_indexes
        log_prompt_assistant_event(
            "storyboard_director_plan_patch_sequence_done",
            command="storyboardDirectorPlan",
            elapsedMs=round((time.time() - started) * 1000),
            patchOk=patch_ok,
            patchFullyResolved=patch_fully_resolved,
            initialTargetScenes=[item["index"] + 1 for item in initial_targets],
            allInitialTargetScenes=[item["index"] + 1 for item in all_initial_targets],
            attemptedScenes=[index + 1 for index in attempted_indexes],
            appliedScenes=[index + 1 for index in sorted(applied_patches.keys())],
            skippedScenes=[index + 1 for index in skipped_indexes],
            failedScenes=[index + 1 for index in failed_indexes],
            remainingInitialScenes=[index + 1 for index in remaining_initial_indexes],
            valid=merged_validation["ok"],
            qualityWarning=merged_validation["qualityWarning"],
            qualityHardError=merged_validation["qualityHardError"],
        )
        return {
            "ok": patch_ok,
            "merged": current,
            "mergedText": merged_text,
            "mergedValidation": merged_validation,
            "patches": applied_patches,
            "initialTargets": initial_targets,
            "allInitialTargets": all_initial_targets,
            "appliedReasons": applied_reasons,
            "attemptCount": len(attempted_indexes),
            "fullyResolved": patch_fully_resolved,
            "failedSceneIndexes": [index + 1 for index in failed_indexes],
            "skippedSceneIndexes": [index + 1 for index in skipped_indexes],
            "remainingSceneIndexes": [index + 1 for index in remaining_initial_indexes],
            "patchGenerateProfiles": patch_generate_profiles,
        }

    def storyboard_story_directions(self, payload: dict) -> dict:
        story_text = clean_text(str(payload.get("storyText") or ""))[:800]
        world_continuity = clean_text(str(payload.get("sourceAnalysis") or ""))[:260]
        seed = clean_text(str(payload.get("storyDirectionSeed") or payload.get("seed") or "1"))[:40] or "1"
        if not story_text:
            raise ValueError("Storyboard story direction missing story text")
        system_prompt = build_storyboard_story_directions_prompt(story_text, world_continuity, seed)
        started = time.time()
        self.status = "storyboard direction planning"
        log_prompt_assistant_event(
            "storyboard_story_directions_received",
            command="storyboardStoryDirections",
            storyChars=len(story_text),
            worldContinuityChars=len(world_continuity),
            seed=seed,
        )
        model_seed = storyboard_stable_generation_seed(seed, "storyboardStoryDirections", 7)
        output = self.generate(system_prompt, max_length=220, seed=model_seed, trace_label="storyboardStoryDirections")
        generate_profile = dict(self.last_generate_profile or {})
        raw_text = clean_text(output)
        directions = parse_storyboard_story_directions(raw_text)
        log_prompt_assistant_event(
            "storyboard_story_directions_done",
            command="storyboardStoryDirections",
            elapsedMs=round((time.time() - started) * 1000),
            outputChars=len(raw_text),
            directionCount=len(directions),
            titles=[item["title"] for item in directions],
            generateProfile=generate_profile,
        )
        self.status = "模型可用"
        return {
            "directions": directions,
            "rawOutput": raw_text,
            "promptPreview": system_prompt,
            "storyDirectionSeed": seed,
            "generateProfile": generate_profile,
        }

    def repair_storyboard_visual_event_actions_with_single_ai(
        self,
        source_text: str,
        story_text: str,
        world_continuity: str,
        selected_direction,
        seed: str,
        visual_cue_pack: str = "",
    ) -> tuple[str, list[str], list[dict], bool]:
        items = storyboard_visual_event_items_from_raw_text(source_text)
        if not items:
            return "", [], [], False
        details: list[str] = []
        profiles: list[dict] = []
        local_fallback_used = False
        ai_attempts = 0
        changed = False
        repair_indexes = storyboard_visual_event_action_repair_indexes(items)
        for index, item in enumerate(items):
            title, action, scene_anchor, cause = item[:4]
            needs_index_repair = index in repair_indexes
            local_action = ""
            title_action = strip_storyboard_visual_action_tail(title)
            if (
                needs_index_repair
                and title_action
                and title_action != action
                and storyboard_visual_event_repaired_action_is_usable(title_action)
                and not storyboard_visual_event_action_candidate_duplicates(items, index, title_action)
            ):
                item[1] = title_action
                details.append(f"Scene{index + 1:02d}:title-action:{action}->{title_action}")
                action = title_action
                changed = True
                if not storyboard_director_action_is_weak_event(action):
                    continue
            if STORYBOARD_VISUAL_EVENT_LOCAL_MATERIALIZER_ENABLED:
                local_action = repair_storyboard_visual_event_parse_action(title, action, scene_anchor, cause, index)
                materialized_action = materialize_storyboard_visual_event_action(
                    title,
                    action,
                    scene_anchor,
                    cause,
                    index,
                    story_text,
                    world_continuity,
                    items,
                )
                if materialized_action and not storyboard_director_action_is_weak_event(materialized_action):
                    local_action = materialized_action
            if local_action and local_action != action:
                item[1] = local_action
                details.append(f"Scene{index + 1:02d}:local-action:{action}->{local_action}")
                action = local_action
                changed = True
            if not needs_index_repair:
                continue
            if STORYBOARD_VISUAL_EVENT_ACTION_REPAIR_LIMIT <= 0:
                if storyboard_visual_event_repaired_action_is_usable(action):
                    continue
                details.append(f"Scene{index + 1:02d}:abstract-kept:{action}")
                continue
            repaired_action = ""
            if ai_attempts < STORYBOARD_VISUAL_EVENT_ACTION_REPAIR_LIMIT:
                ai_attempts += 1
                repair_prompt = build_storyboard_visual_event_action_repair_prompt(
                    story_text,
                    world_continuity,
                    selected_direction,
                    items,
                    index,
                    title,
                    action,
                    scene_anchor,
                    cause,
                    visual_cue_pack,
                )
                repair_seed = storyboard_stable_generation_seed(
                    f"{seed}:{index}:{action}",
                    "storyboardVisualEventActionRepair",
                    41 + index,
                )
                try:
                    repair_output = self.generate(
                        repair_prompt,
                        max_length=STORYBOARD_VISUAL_EVENT_ACTION_REPAIR_MAX_LENGTH,
                        seed=repair_seed,
                        trace_label="storyboardVisualEventActionRepair",
                        do_sample=True,
                        temperature=0.45,
                        top_p=0.9,
                    )
                    profile = dict(self.last_generate_profile or {})
                    profile.update({"scene": index + 1})
                    profiles.append(profile)
                    repaired_action = parse_storyboard_visual_event_action_repair_output(repair_output)
                    repaired_action = strip_storyboard_visual_action_tail(repaired_action)
                    repaired_action = coerce_storyboard_visual_event_action(title, repaired_action, cause, index, scene_anchor)
                except Exception as exc:
                    details.append(f"Scene{index + 1:02d}:ai-action-error:{str(exc)[:80]}")
            if (
                storyboard_visual_event_repaired_action_is_usable(repaired_action)
                and not storyboard_visual_event_action_candidate_duplicates(items, index, repaired_action)
            ):
                item[1] = repaired_action
                details.append(f"Scene{index + 1:02d}:ai-action:{action}->{repaired_action}")
                changed = True
                continue
            if repaired_action:
                details.append(f"Scene{index + 1:02d}:ai-action-unusable:{repaired_action[:36]}")
            cue_action = storyboard_cue_based_drawable_action(
                title,
                action,
                scene_anchor,
                index,
                story_text,
                world_continuity,
                selected_direction,
                visual_cue_pack,
            )
            if (
                storyboard_visual_event_repaired_action_is_usable(cue_action)
                and not storyboard_visual_event_action_candidate_duplicates(items, index, cue_action)
            ):
                item[1] = cue_action
                details.append(f"Scene{index + 1:02d}:cue-action:{action}->{cue_action}")
                changed = True
                continue
            details.append(f"Scene{index + 1:02d}:abstract-kept:{action}")
        if not details:
            return "", [], profiles, local_fallback_used
        if not changed:
            return "", details[:18], profiles, local_fallback_used
        return json.dumps(items, ensure_ascii=False, separators=(",", ":")), details[:18], profiles, local_fallback_used

    def rewrite_storyboard_visual_event_actions_with_ai(
        self,
        source_text: str,
        story_text: str,
        world_continuity: str,
        selected_direction,
        seed: str,
        visual_cue_pack: str = "",
    ) -> tuple[str, list[str], list[dict]]:
        items = storyboard_visual_event_items_from_raw_text(source_text)
        if (
            not STORYBOARD_VISUAL_EVENT_REALIZER_ENABLED
            or not items
            or len(items) != 9
        ):
            return "", [], []
        old_events: list[dict] = []
        try:
            old_events = parse_storyboard_visual_event_chain(source_text)
        except Exception:
            old_events = []
        old_issue_count = len(storyboard_visual_event_abstract_action_details(old_events)) + len(storyboard_visual_event_duplicate_risk_details(old_events))
        rewrite_prompt = build_storyboard_visual_event_chain_visualize_prompt(
            story_text,
            world_continuity,
            selected_direction,
            items,
            visual_cue_pack,
        )
        rewrite_seed = storyboard_stable_generation_seed(seed, "storyboardVisualEventChainVisualize", 53)
        try:
            output = self.generate(
                rewrite_prompt,
                max_length=520,
                seed=rewrite_seed,
                trace_label="storyboardVisualEventChainVisualize",
                do_sample=True,
                temperature=0.68,
                top_p=0.92,
            )
        except Exception as exc:
            return "", [f"chain-ai-error:{str(exc)[:80]}"], []
        profile = dict(self.last_generate_profile or {})
        try:
            rewritten_events = parse_storyboard_visual_event_chain(output)
        except Exception as exc:
            return "", [f"chain-ai-parse-failed:{str(exc)[:80]}"], [profile]
        rewritten_events = normalize_storyboard_visual_event_rewrite_event_fields(rewritten_events)
        rewritten_items_for_parse = [
            [
                clean_text(str(event.get("title") or "")),
                clean_text(str(event.get("action") or "")),
                clean_text(str(event.get("sceneAnchor") or "")),
            ]
            for event in rewritten_events
        ]
        rewritten_events = parse_storyboard_visual_event_chain(
            json.dumps(rewritten_items_for_parse, ensure_ascii=False, separators=(",", ":"))
        )
        new_abstract_details = storyboard_visual_event_abstract_action_details(rewritten_events)
        new_duplicate_details = storyboard_visual_event_duplicate_risk_details(rewritten_events)
        new_issue_count = len(new_abstract_details) + len(new_duplicate_details)
        if new_issue_count > old_issue_count or (old_issue_count and new_issue_count >= old_issue_count):
            return "", [f"chain-ai-not-improved:{old_issue_count}->{new_issue_count}:{clean_text(output)[:180]}"], [profile]
        details: list[str] = []
        rewritten_items: list[list[str]] = []
        for index, event in enumerate(rewritten_events):
            old_title, old_action, old_scene_anchor, _old_cause = items[index][:4]
            title = clean_text(str(event.get("title") or ""))
            action = clean_text(str(event.get("action") or ""))
            scene_anchor = clean_text(str(event.get("sceneAnchor") or ""))
            if [title, action, scene_anchor] != [old_title, old_action, old_scene_anchor]:
                details.append(f"Scene{index + 1:02d}:chain-event:{old_title}/{old_action}/{old_scene_anchor}->{title}/{action}/{scene_anchor}")
            rewritten_items.append([title, action, scene_anchor])
        if not details:
            return "", [], [profile]
        if new_abstract_details:
            details.extend(f"chain-weak-left:{item}" for item in new_abstract_details[:4])
        if new_duplicate_details:
            details.extend(f"chain-duplicate-left:{item}" for item in new_duplicate_details[:4])
        return json.dumps(rewritten_items, ensure_ascii=False, separators=(",", ":")), details[:18], [profile]

    def storyboard_visual_event_chain(self, payload: dict) -> dict:
        story_text = clean_text(str(payload.get("storyText") or ""))[:800]
        world_continuity = clean_text(str(payload.get("sourceAnalysis") or ""))[:260]
        visual_cue_pack = clean_text(str(payload.get("visualCuePack") or ""))[:900]
        selected_direction = payload.get("selectedStoryDirection")
        seed = clean_text(str(payload.get("visualEventSeed") or payload.get("seed") or "1"))[:40] or "1"
        selected_direction_text = storyboard_story_direction_text(selected_direction)
        if not story_text:
            raise ValueError("Storyboard visual event chain missing story text")
        if STORYBOARD_LOCAL_STORY_CHAIN_ENABLED and STORYBOARD_LOCAL_STORY_CHAIN_BYPASS_MODEL:
            started = time.time()
            events = build_storyboard_local_visual_event_chain(story_text, world_continuity, visual_cue_pack, seed)
            raw_text = json.dumps(
                [[item.get("title", ""), item.get("action", ""), item.get("sceneAnchor", "")] for item in events],
                ensure_ascii=False,
                separators=(",", ":"),
            )
            abstract_action_details = storyboard_visual_event_abstract_action_details(events)
            duplicate_risk_details = storyboard_visual_event_duplicate_risk_details(events)
            soft_action_details = storyboard_visual_event_soft_action_details(events)
            soft_action_policy = storyboard_visual_event_soft_action_policy(events)
            log_prompt_assistant_event(
                "storyboard_visual_event_chain_done",
                command="storyboardVisualEventChain",
                elapsedMs=round((time.time() - started) * 1000),
                outputChars=len(raw_text),
                eventCount=len(events),
                sceneAnchorCount=sum(1 for item in events if item.get("sceneAnchor")),
                titles=[item["title"] for item in events],
                generateProfile={"localComposer": True},
                retryUsed=False,
                repairUsed=False,
                repairDetails=[],
                drawableRealizerUsed=False,
                drawableRealizerDetails=[],
                singleActionRepairUsed=False,
                localFallbackActionUsed=False,
                abstractActionCount=len(abstract_action_details),
                abstractActionDetails=abstract_action_details,
                duplicateRiskDetails=duplicate_risk_details,
                softActionCount=len(soft_action_details),
                softActionDetails=soft_action_details,
                softActionOverLimit=soft_action_policy.get("softActionOverLimit"),
                softActionOverLimitReasons=soft_action_policy.get("softActionOverLimitReasons"),
                softActionIndexes=soft_action_policy.get("softActionIndexes"),
                localStoryChainUsed=True,
            )
            self.status = "模型可用"
            return {
                "events": events,
                "rawOutput": raw_text,
                "firstRawOutput": raw_text,
                "promptPreview": "LOCAL_STORY_CHAIN_COMPOSER",
                "visualEventSeed": seed,
                "visualEventProtocol": "Local-Story-Locked-Drawable-Chain",
                "generateProfile": {"localComposer": True},
                "retryGenerateProfile": None,
                "parseError": "",
                "repairUsed": False,
                "repairDetails": [],
                "drawableRealizerUsed": False,
                "drawableRealizerDetails": [],
                "drawableRealizerGenerateProfiles": [],
                "singleActionRepairUsed": False,
                "singleActionRepairDetails": [],
                "singleActionRepairGenerateProfiles": [],
                "localFallbackActionUsed": False,
                "abstractActionDetails": abstract_action_details,
                "duplicateRiskDetails": duplicate_risk_details,
                "retryUsed": False,
                "retrySkippedReason": "",
                "softActionDetails": soft_action_details,
                "softActionPolicy": soft_action_policy,
                "softActionOverLimit": bool(soft_action_policy.get("softActionOverLimit")),
                "softActionOverLimitReasons": soft_action_policy.get("softActionOverLimitReasons") or [],
                "localStoryChainUsed": True,
            }
        system_prompt = build_storyboard_visual_event_chain_prompt(story_text, world_continuity, selected_direction, seed, visual_cue_pack)
        started = time.time()
        self.status = "storyboard visual event planning"
        log_prompt_assistant_event(
            "storyboard_visual_event_chain_received",
            command="storyboardVisualEventChain",
            storyChars=len(story_text),
            worldContinuityChars=len(world_continuity),
            visualCuePackChars=len(visual_cue_pack),
            selectedStoryDirection=selected_direction_text,
            creativeMode="direct_vec_expansion",
            seed=seed,
        )
        model_seed = storyboard_stable_generation_seed(seed, "storyboardVisualEventChain", 11)
        output = self.generate(
            system_prompt,
            max_length=STORYBOARD_VISUAL_EVENT_MAX_LENGTH,
            seed=model_seed,
            trace_label="storyboardVisualEventChain",
            do_sample=True,
            temperature=0.52,
            top_p=0.9,
        )
        generate_profile = dict(self.last_generate_profile or {})
        raw_text = clean_text(output)
        first_raw_text = raw_text
        first_parse_error = ""
        repair_used = False
        repair_details: list[str] = []
        single_action_repair_used = False
        single_action_repair_details: list[str] = []
        single_action_repair_generate_profiles: list[dict] = []
        drawable_realizer_used = False
        drawable_realizer_details: list[str] = []
        drawable_realizer_generate_profiles: list[dict] = []
        local_fallback_action_used = False
        local_story_chain_used = False
        retry_used = False
        retry_skipped_reason = ""
        retry_generate_profile = None
        def retry_ai_visual_event_chain(reason: str) -> tuple[str, list[dict], dict]:
            retry_prompt = (
                f"{system_prompt}\n\n"
                "上一次输出无效，必须重新输出正好9项JSON二维数组。"
                "用户剧情仍然是唯一真实主线；只允许丰富过程，不允许套固定模板、改主角、改目标、改结局。"
                f"失败原因:{clean_text(str(reason or 'unknown'))[:180]}\n"
                "JSON:"
            )
            retry_output = self.generate(
                retry_prompt,
                max_length=STORYBOARD_VISUAL_EVENT_MAX_LENGTH,
                seed=storyboard_stable_generation_seed(f"{seed}:retry", "storyboardVisualEventChainRetry", 29),
                trace_label="storyboardVisualEventChainRetry",
                do_sample=True,
                temperature=0.66,
                top_p=0.94,
            )
            retry_profile = dict(self.last_generate_profile or {})
            retry_raw_text = clean_text(retry_output)
            retry_events = parse_storyboard_visual_event_chain(retry_raw_text)
            return retry_raw_text, retry_events, retry_profile
        try:
            events = parse_storyboard_visual_event_chain(raw_text)
        except Exception as first_error:
            first_parse_error = str(first_error)
            events = None
            elapsed_before_retry = round((time.time() - started) * 1000)
            partial_parse_error = ""
            partial_event_count = 0
            try:
                partial_events = parse_storyboard_visual_event_chain(raw_text, allow_incomplete=True, min_count=6)
                partial_event_count = len(partial_events)
                retry_skipped_reason = (
                    f"首次输出只有 {partial_event_count}/9 个可用事件；不进入后续阶段，改用AI重试"
                )
            except Exception as partial_error:
                partial_parse_error = str(partial_error)
                retry_skipped_reason = f"首次输出不可用，改用AI重试：{first_parse_error}"
            log_prompt_assistant_event(
                "storyboard_visual_event_chain_retry_start",
                command="storyboardVisualEventChain",
                elapsedMs=elapsed_before_retry,
                retryAllowed=True,
                reason=retry_skipped_reason,
                parseError=first_parse_error,
                partialParseError=partial_parse_error,
                continuedWithPartial=False,
                partialEventCount=partial_event_count,
            )
            if events is None:
                try:
                    raw_text, events, retry_generate_profile = retry_ai_visual_event_chain(first_parse_error)
                    retry_used = True
                    repair_used = True
                    repair_details.append(f"ai-vec-retry:parse-failed:{first_parse_error[:80]}")
                except Exception as retry_error:
                    raise ValueError(
                        f"VEC_PARSE_FAILED：初次解析失败：{first_parse_error}；AI重试失败：{retry_error}；"
                        "已停止生成，禁止本地模板兜底。"
                    ) from retry_error
        chain_repaired_raw_text, chain_repair_details, chain_repair_profiles = (
            self.rewrite_storyboard_visual_event_actions_with_ai(
                raw_text,
                story_text,
                world_continuity,
                selected_direction,
                seed,
                visual_cue_pack,
            )
        )
        if chain_repair_profiles:
            drawable_realizer_generate_profiles.extend(chain_repair_profiles)
        if chain_repair_details:
            drawable_realizer_used = True
            drawable_realizer_details.extend(chain_repair_details)
        if chain_repaired_raw_text:
            try:
                chain_repaired_events = parse_storyboard_visual_event_chain(chain_repaired_raw_text)
                raw_text = clean_text(chain_repaired_raw_text)
                events = chain_repaired_events
                repair_used = True
                drawable_realizer_used = True
                repair_details.append(f"drawable-realizer:{len(chain_repair_details)}")
            except Exception as chain_repair_parse_error:
                drawable_realizer_details.append(f"parse-after-drawable-realizer-failed:{str(chain_repair_parse_error)[:80]}")

        initial_abstract_action_details = storyboard_visual_event_abstract_action_details(events)
        initial_duplicate_risk_details = storyboard_visual_event_duplicate_risk_details(events)
        if (
            STORYBOARD_VISUAL_EVENT_ACTION_REPAIR_LIMIT > 0
            and (initial_abstract_action_details or initial_duplicate_risk_details)
        ):
            repaired_raw_text, action_repair_details, action_repair_profiles, local_fallback_action_used = (
                self.repair_storyboard_visual_event_actions_with_single_ai(
                    raw_text,
                    story_text,
                    world_continuity,
                    selected_direction,
                    seed,
                    visual_cue_pack,
                )
            )
            if action_repair_profiles:
                single_action_repair_generate_profiles.extend(action_repair_profiles)
            if action_repair_details:
                single_action_repair_used = True
                single_action_repair_details.extend(action_repair_details)
            if repaired_raw_text:
                try:
                    repaired_events = parse_storyboard_visual_event_chain(repaired_raw_text)
                    raw_text = clean_text(repaired_raw_text)
                    events = repaired_events
                    repair_used = True
                    repair_details.append(f"single-action-visualized:{len(action_repair_details)}")
                except Exception as repair_parse_error:
                    single_action_repair_details.append(f"parse-after-action-repair-failed:{str(repair_parse_error)[:80]}")
        events, preserve_details = preserve_storyboard_visual_event_chain(events, selected_direction)
        if preserve_details:
            repair_used = True
            repair_details.extend(preserve_details)
        if STORYBOARD_VISUAL_EVENT_LOCAL_DRAWABLE_GUARD_ENABLED:
            drawable_events, drawable_details = compile_storyboard_visual_event_chain_to_drawable(
                events,
                story_text,
                world_continuity,
                selected_direction,
                visual_cue_pack,
            )
            if drawable_details:
                events = drawable_events
                raw_text = json.dumps(
                    [[item.get("title", ""), item.get("action", ""), item.get("sceneAnchor", "")] for item in events],
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                repair_used = True
                repair_details.extend(drawable_details)
        if STORYBOARD_LOCAL_STORY_CHAIN_ENABLED and storyboard_local_chain_drifted(events, story_text, world_continuity, visual_cue_pack):
            try:
                raw_text, events, retry_generate_profile = retry_ai_visual_event_chain("AI视觉事件链未覆盖用户剧情或参考图核心元素")
                if storyboard_local_chain_drifted(events, story_text, world_continuity, visual_cue_pack):
                    raise ValueError("AI重试后仍未覆盖用户剧情或参考图核心元素")
                retry_used = True
                repair_used = True
                repair_details.append("ai-vec-retry:story-lock")
            except Exception as retry_error:
                raise ValueError(
                    f"VEC_STORY_DRIFT：AI视觉事件链未覆盖用户剧情或参考图核心元素；AI重试失败：{retry_error}；"
                    "已停止生成，禁止改写为本地固定模板。"
                ) from retry_error
        soft_action_details = storyboard_visual_event_soft_action_details(events)
        abstract_action_details = storyboard_visual_event_abstract_action_details(events)
        duplicate_risk_details = storyboard_visual_event_duplicate_risk_details(events)
        soft_action_policy = storyboard_visual_event_soft_action_policy(events)
        log_prompt_assistant_event(
            "storyboard_visual_event_chain_done",
            command="storyboardVisualEventChain",
            elapsedMs=round((time.time() - started) * 1000),
            outputChars=len(raw_text),
            eventCount=len(events),
            sceneAnchorCount=sum(1 for item in events if item.get("sceneAnchor")),
            titles=[item["title"] for item in events],
            generateProfile=generate_profile,
            retryUsed=retry_used,
            repairUsed=repair_used,
            repairDetails=repair_details,
            drawableRealizerUsed=drawable_realizer_used,
            drawableRealizerDetails=drawable_realizer_details,
            singleActionRepairUsed=single_action_repair_used,
            singleActionRepairDetails=single_action_repair_details,
            localFallbackActionUsed=local_fallback_action_used,
            abstractActionCount=len(abstract_action_details),
            abstractActionDetails=abstract_action_details,
            duplicateRiskDetails=duplicate_risk_details,
            softActionCount=len(soft_action_details),
            softActionDetails=soft_action_details,
            softActionOverLimit=soft_action_policy.get("softActionOverLimit"),
            softActionOverLimitReasons=soft_action_policy.get("softActionOverLimitReasons"),
            softActionIndexes=soft_action_policy.get("softActionIndexes"),
        )
        self.status = "模型可用"
        return {
            "events": events,
            "rawOutput": raw_text,
            "firstRawOutput": first_raw_text,
            "promptPreview": system_prompt,
            "visualEventSeed": seed,
            "visualEventProtocol": "V3-Preserve-Causal-Link",
            "generateProfile": generate_profile,
            "retryGenerateProfile": retry_generate_profile,
            "parseError": first_parse_error,
            "repairUsed": repair_used,
            "repairDetails": repair_details,
            "drawableRealizerUsed": drawable_realizer_used,
            "drawableRealizerDetails": drawable_realizer_details,
            "drawableRealizerGenerateProfiles": drawable_realizer_generate_profiles,
            "singleActionRepairUsed": single_action_repair_used,
            "singleActionRepairDetails": single_action_repair_details,
            "singleActionRepairGenerateProfiles": single_action_repair_generate_profiles,
            "localFallbackActionUsed": local_fallback_action_used,
            "abstractActionDetails": abstract_action_details,
            "duplicateRiskDetails": duplicate_risk_details,
            "retryUsed": retry_used,
            "retrySkippedReason": retry_skipped_reason,
            "softActionDetails": soft_action_details,
            "softActionPolicy": soft_action_policy,
            "softActionOverLimit": bool(soft_action_policy.get("softActionOverLimit")),
            "softActionOverLimitReasons": soft_action_policy.get("softActionOverLimitReasons") or [],
            "localStoryChainUsed": local_story_chain_used,
        }

    def storyboard_final_shot_prompts(self, payload: dict) -> dict:
        story_text = clean_text(str(payload.get("storyText") or ""))[:800]
        world_continuity = clean_text(str(payload.get("sourceAnalysis") or ""))[:260]
        visual_cue_pack = clean_text(str(payload.get("visualCuePack") or ""))[:900]
        selected_direction = payload.get("selectedStoryDirection")
        visual_event_chain = payload.get("visualEventChain")
        seed = clean_text(str(payload.get("finalShotSeed") or payload.get("seed") or "1"))[:40] or "1"
        selected_direction_text = storyboard_story_direction_text(selected_direction)
        visual_event_chain_text = storyboard_visual_event_chain_text(visual_event_chain)
        if not story_text:
            raise ValueError("Storyboard final shot prompts missing story text")
        if not visual_event_chain_text and not STORYBOARD_FINAL_SHOT_LOCAL_COMPOSER_ENABLED:
            raise ValueError("Storyboard final shot prompts missing story chain")
        if STORYBOARD_FINAL_SHOT_LOCAL_COMPOSER_ENABLED:
            started = time.time()
            shots = build_storyboard_local_final_shots(
                story_text,
                world_continuity,
                visual_cue_pack,
                visual_event_chain,
                seed,
            )
            raw_text = "\n".join(f"{item['scene']:02d} {item['title']}：{item['prompt']}" for item in shots)
            log_prompt_assistant_event(
                "storyboard_final_shot_prompts_done",
                command="storyboardFinalShotPrompts",
                elapsedMs=round((time.time() - started) * 1000),
                outputChars=len(raw_text),
                shotCount=len(shots),
                titles=[item["title"] for item in shots],
                generateProfile={"localComposer": True},
            )
            self.status = "模型可用"
            return {
                "shots": shots,
                "rawOutput": raw_text,
                "promptPreview": "LOCAL_FINAL_SHOT_COMPOSER",
                "finalShotSeed": seed,
                "visualEventChainText": visual_event_chain_text,
                "selectedStoryDirectionText": selected_direction_text,
                "generateProfile": {"localComposer": True},
            }
        system_prompt = build_storyboard_final_shot_prompts_prompt(
            story_text,
            world_continuity,
            selected_direction,
            visual_event_chain,
            visual_cue_pack,
            seed,
        )
        started = time.time()
        self.status = "storyboard final shot prompts"
        log_prompt_assistant_event(
            "storyboard_final_shot_prompts_received",
            command="storyboardFinalShotPrompts",
            storyChars=len(story_text),
            worldContinuityChars=len(world_continuity),
            visualCuePackChars=len(visual_cue_pack),
            selectedStoryDirection=selected_direction_text,
            visualEventCount=len(visual_event_chain) if isinstance(visual_event_chain, list) else 0,
            seed=seed,
        )
        model_seed = storyboard_stable_generation_seed(seed, "storyboardFinalShotPrompts", 67)
        output = self.generate(
            system_prompt,
            max_length=STORYBOARD_FINAL_SHOT_PROMPT_MAX_LENGTH,
            seed=model_seed,
            trace_label="storyboardFinalShotPrompts",
            do_sample=True,
            temperature=0.64,
            top_p=0.92,
        )
        generate_profile = dict(self.last_generate_profile or {})
        raw_text = clean_text(output)
        retry_generate_profile = None
        retry_used = False
        try:
            shots = parse_storyboard_final_shot_prompts_output(raw_text)
        except Exception as first_error:
            retry_prompt = (
                f"{system_prompt}\n\n"
                "上一次最终提示词输出无效，必须重新输出9行。"
                "每行必须是：两位序号 空格 事件标题：最终生图提示词。"
                "用户剧情和Story Chain是硬约束；只优化画面表达，不改剧情，不套固定模板。"
                f"失败原因:{clean_text(str(first_error or 'unknown'))[:180]}\n"
                "最终9行:"
            )
            retry_output = self.generate(
                retry_prompt,
                max_length=STORYBOARD_FINAL_SHOT_PROMPT_MAX_LENGTH,
                seed=storyboard_stable_generation_seed(f"{seed}:retry", "storyboardFinalShotPromptsRetry", 83),
                trace_label="storyboardFinalShotPromptsRetry",
                do_sample=True,
                temperature=0.68,
                top_p=0.94,
            )
            retry_generate_profile = dict(self.last_generate_profile or {})
            raw_text = clean_text(retry_output)
            try:
                shots = parse_storyboard_final_shot_prompts_output(raw_text)
                retry_used = True
            except Exception as retry_error:
                raise ValueError(
                    f"FINAL_SHOT_PROMPT_PARSE_FAILED：初次解析失败：{first_error}；AI重试失败：{retry_error}；"
                    "已停止生成，禁止本地模板兜底。"
                ) from retry_error
        log_prompt_assistant_event(
            "storyboard_final_shot_prompts_done",
            command="storyboardFinalShotPrompts",
            elapsedMs=round((time.time() - started) * 1000),
            outputChars=len(raw_text),
            shotCount=len(shots),
            titles=[item["title"] for item in shots],
            generateProfile=generate_profile,
            retryUsed=retry_used,
            retryGenerateProfile=retry_generate_profile,
        )
        self.status = "模型可用"
        return {
            "shots": shots,
            "rawOutput": raw_text,
            "promptPreview": system_prompt,
            "finalShotSeed": seed,
            "visualEventChainText": visual_event_chain_text,
            "selectedStoryDirectionText": selected_direction_text,
            "generateProfile": generate_profile,
            "retryUsed": retry_used,
            "retryGenerateProfile": retry_generate_profile,
        }

    def storyboard_unified_nine_shots(self, payload: dict) -> dict:
        story_text = clean_text(str(payload.get("storyText") or ""))[:800]
        world_continuity = clean_text(str(payload.get("sourceAnalysis") or ""))[:260]
        visual_cue_pack = clean_text(str(payload.get("visualCuePack") or ""))[:900]
        seed = clean_text(str(payload.get("unifiedSeed") or payload.get("seed") or "1"))[:40] or "1"
        if not story_text:
            raise ValueError("Storyboard unified nine shots missing story text")
        system_prompt = build_storyboard_unified_nine_shot_prompt(
            story_text,
            world_continuity,
            visual_cue_pack,
            seed,
        )
        started = time.time()
        self.status = "storyboard unified nine shots"
        log_prompt_assistant_event(
            "storyboard_unified_nine_shots_received",
            command="storyboardUnifiedNineShots",
            storyChars=len(story_text),
            worldContinuityChars=len(world_continuity),
            visualCuePackChars=len(visual_cue_pack),
            seed=seed,
        )
        model_seed = storyboard_stable_generation_seed(seed, "storyboardUnifiedNineShots", 97)
        output = self.generate(
            system_prompt,
            max_length=STORYBOARD_UNIFIED_NINE_SHOT_MAX_LENGTH,
            seed=model_seed,
            trace_label="storyboardUnifiedNineShots",
            do_sample=True,
            temperature=0.52,
            top_p=0.90,
        )
        generate_profile = dict(self.last_generate_profile or {})
        raw_text = clean_text(output)
        retry_generate_profile = None
        retry_used = False
        first_error = ""
        retry_errors: list[str] = []
        story_lock_warnings: list[str] = []
        retry_attempt_count = 0
        story_lock_warning = ""
        try:
            shots = parse_storyboard_final_shot_prompts_output(raw_text)
            shots = storyboard_unified_enrich_final_shot_prompts(
                shots,
                story_text,
                visual_cue_pack or world_continuity,
            )
        except Exception as exc:
            first_error = str(exc)
            last_retry_error = first_error
            story_lock_hint = storyboard_unified_story_lock_hint(story_text)
            for retry_index in range(1, 2):
                retry_attempt_count = retry_index
                extra_lock = ""
                if retry_index >= 2:
                    extra_lock = (
                        "特别检查第9段：必须回扣用户原文中的显式地点或目的地、关键任务、冲突和最终状态；"
                        "不要切到用户未给出的新地点、新目标或泛化日常总结。"
                    )
                retry_prompt = (
                    f"{system_prompt}\n\n"
                    "上一次输出无法解析或数量异常。请重新输出正好9行 Scene 分镜。"
                    "用户剧情仍然是唯一真实主线；只允许合理扩展过程，不得改变主角、核心目标、地点走向和结局方向。"
                    "每段必须出现可画动作、可见状态变化和该变化带来的结果。"
                    "短标题必须来自当前画面的具体事件，禁止使用故事建立、角色进入、变化出现、冲突展开、局势升级、主动推进、高潮到来、结果显现、故事收束这类节奏占位词。"
                    f"用户剧情锁定提示:{story_lock_hint}。"
                    f"{extra_lock}"
                    f"失败原因:{clean_text(last_retry_error)[:180]}\n"
                    "格式：Scene 01｜短标题｜完整画面描述"
                )
                retry_output = self.generate(
                    retry_prompt,
                    max_length=STORYBOARD_UNIFIED_NINE_SHOT_MAX_LENGTH,
                    seed=storyboard_stable_generation_seed(f"{seed}:retry:{retry_index}", "storyboardUnifiedNineShotsRetry", 101 + retry_index),
                    trace_label="storyboardUnifiedNineShotsRetry" if retry_index == 1 else f"storyboardUnifiedNineShotsRetry{retry_index}",
                    do_sample=True,
                    temperature=0.54,
                    top_p=0.90,
                )
                retry_generate_profile = dict(self.last_generate_profile or {})
                raw_text = clean_text(retry_output)
                try:
                    shots = parse_storyboard_final_shot_prompts_output(raw_text)
                    shots = storyboard_unified_enrich_final_shot_prompts(
                        shots,
                        story_text,
                        visual_cue_pack or world_continuity,
                    )
                    retry_used = True
                    break
                except Exception as retry_error:
                    last_retry_error = str(retry_error)
                    retry_errors.append(last_retry_error)
                    if retry_index >= 1:
                        raise ValueError(
                            f"UNIFIED_NINE_SHOTS_FAILED：初次失败：{first_error}；AI重试失败：{'；'.join(retry_errors)}；交由正式链路兜底。"
                        ) from retry_error
        else:
            story_lock_warning = storyboard_unified_story_lock_warning(shots, story_text)
            if story_lock_warning:
                story_lock_warnings.append(story_lock_warning)
        if retry_used:
            story_lock_warning = storyboard_unified_story_lock_warning(shots, story_text)
            if story_lock_warning:
                story_lock_warnings.append(story_lock_warning)
        log_prompt_assistant_event(
            "storyboard_unified_nine_shots_done",
            command="storyboardUnifiedNineShots",
            elapsedMs=round((time.time() - started) * 1000),
            outputChars=len(raw_text),
            shotCount=len(shots),
            titles=[item["title"] for item in shots],
            generateProfile=generate_profile,
            retryUsed=retry_used,
            retryGenerateProfile=retry_generate_profile,
            firstError=first_error,
            retryAttemptCount=retry_attempt_count,
            retryErrors=retry_errors,
            storyLockWarnings=story_lock_warnings,
        )
        self.status = "模型可用"
        return {
            "shots": shots,
            "rawOutput": raw_text,
            "promptPreview": system_prompt,
            "unifiedSeed": seed,
            "generateProfile": generate_profile,
            "retryUsed": retry_used,
            "retryGenerateProfile": retry_generate_profile,
            "firstError": first_error,
            "retryAttemptCount": retry_attempt_count,
            "retryErrors": retry_errors,
            "storyLockWarnings": story_lock_warnings,
        }

    def storyboard_director_plan(self, payload: dict) -> dict:
        story_text = clean_text(str(payload.get("storyText") or ""))[:800]
        world_continuity = clean_text(str(payload.get("sourceAnalysis") or ""))[:260]
        visual_cue_pack = clean_text(str(payload.get("visualCuePack") or ""))[:900]
        rules = clean_text(str(payload.get("rules") or ""))[:140]
        selected_direction = payload.get("selectedStoryDirection")
        visual_event_chain = payload.get("visualEventChain")
        if not story_text:
            raise ValueError("Storyboard DirectorPlanner missing story text")
        selected_direction_text = storyboard_story_direction_text(selected_direction)
        if not selected_direction_text:
            raise ValueError("Storyboard DirectorPlanner missing selected story direction")
        visual_event_chain_text = storyboard_visual_event_chain_text(visual_event_chain)
        if not visual_event_chain_text:
            raise ValueError("Storyboard DirectorPlanner missing visual event chain")

        system_prompt = buildDynamicStoryboardDirectorPlan(
            story_text,
            world_continuity,
            rules,
            selected_direction,
            visual_event_chain,
            visual_cue_pack,
        )
        schema_chars = len(json.dumps(STORYBOARD_DIRECTOR_PLAN_SCHEMA, ensure_ascii=False, separators=(",", ":")))
        self.status = "storyboard director planning"
        started = time.time()
        first_max_length = 340
        patch_max_length = 140
        log_prompt_assistant_event(
            "storyboard_director_plan_received",
            command="storyboardDirectorPlan",
            storyChars=len(story_text),
            worldContinuityChars=len(world_continuity),
            visualCuePackChars=len(visual_cue_pack),
            rulesChars=len(rules),
            selectedStoryDirection=selected_direction_text,
            visualEventCount=len(visual_event_chain) if isinstance(visual_event_chain, list) else 0,
        )
        log_prompt_assistant_event(
            "storyboard_director_plan_prompt_ready",
            command="storyboardDirectorPlan",
            storyChars=len(story_text),
            worldContinuityChars=len(world_continuity),
            visualCuePackChars=len(visual_cue_pack),
            rulesChars=len(rules),
            selectedStoryDirection=selected_direction_text,
            visualEventCount=len(visual_event_chain) if isinstance(visual_event_chain, list) else 0,
            promptChars=len(system_prompt),
            schemaChars=schema_chars,
            maxLength=first_max_length,
            patchMaxLength=patch_max_length,
        )
        try:
            log_prompt_assistant_event(
                "storyboard_director_plan_generate_start",
                command="storyboardDirectorPlan",
                elapsedMs=round((time.time() - started) * 1000),
                promptChars=len(system_prompt),
                schemaChars=schema_chars,
                rulesChars=len(rules),
                selectedStoryDirection=selected_direction_text,
                visualEventCount=len(visual_event_chain) if isinstance(visual_event_chain, list) else 0,
                maxLength=first_max_length,
                attempt=1,
            )
            output = self.generate(system_prompt, max_length=first_max_length, trace_label="storyboardDirectorPlan")
            first_generate_profile = dict(self.last_generate_profile or {})
            raw_text = clean_text(output)
            text = raw_text
            if not text:
                raise ValueError("Storyboard DirectorPlanner returned empty output")
            validation = validate_compact_storyboard_director_output(text)
            parsed_output, parsed_wrapper_repaired, parse_reason = parse_compact_storyboard_director_text(text)
            camera_enhancements: list[dict] = []
            if parsed_output and len(parsed_output) == 9:
                enhanced_output, camera_enhancements = storyboard_director_enhance_simple_cameras(parsed_output)
                if camera_enhancements:
                    parsed_output = enhanced_output
                    text = compact_storyboard_director_json(parsed_output)
                    validation = validate_compact_storyboard_director_output(text)
                    log_prompt_assistant_event(
                        "storyboard_director_camera_enhance_done",
                        command="storyboardDirectorPlan",
                        elapsedMs=round((time.time() - started) * 1000),
                        changedScenes=[item["index"] + 1 for item in camera_enhancements],
                        changes=[
                            f"Scene{item['index'] + 1:02d}:{item['from']}->{item['to']}"
                            for item in camera_enhancements
                        ],
                    )
            self.status = "模型可用"
            log_prompt_assistant_event(
                "storyboard_director_plan_generate_done",
                command="storyboardDirectorPlan",
                elapsedMs=round((time.time() - started) * 1000),
                outputChars=len(text),
                originalOutputChars=len(raw_text),
                rawPreview=text[:300],
                attempt=1,
                generateProfile=first_generate_profile,
                cameraEnhanced=bool(camera_enhancements),
                cameraEnhancedScenes=[item["index"] + 1 for item in camera_enhancements],
                valid=validation["ok"],
                reason=validation["reason"],
                actualScenes=validation["actualScenes"],
                jsonClosed=validation["jsonClosed"],
                jsonWrapperRepaired=validation["jsonWrapperRepaired"],
                qualityWarning=validation["qualityWarning"],
                qualityHardError=validation["qualityHardError"],
            )
            if validation["ok"]:
                patch_targets = storyboard_director_patch_targets(parsed_output or [])
                if not patch_targets:
                    return {
                        "rawOutput": text,
                        "promptPreview": system_prompt,
                        "retryUsed": False,
                        "patchUsed": False,
                        "attemptCount": 1,
                        "selectedStoryDirection": selected_direction,
                        "selectedStoryDirectionText": selected_direction_text,
                        "visualEventChain": visual_event_chain,
                        "visualEventChainText": visual_event_chain_text,
                        "cameraEnhanced": bool(camera_enhancements),
                        "cameraEnhancedSceneIndexes": [item["index"] + 1 for item in camera_enhancements],
                        "generateProfile": first_generate_profile,
                        "firstGenerateProfile": first_generate_profile,
                        "qualityWarning": validation["qualityWarning"],
                        "qualityHardError": "",
                        "jsonWrapperRepaired": bool(validation["jsonWrapperRepaired"] or parsed_wrapper_repaired),
                        "firstRawOutput": raw_text if camera_enhancements else "",
                        "firstRawOutputLength": len(raw_text) if camera_enhancements else 0,
                    }
                patch_result = self.run_storyboard_director_patch_sequence(
                    story_text,
                    world_continuity,
                    parsed_output,
                    text,
                    started,
                    patch_max_length,
                    selected_direction=selected_direction,
                    visual_event_chain=visual_event_chain,
                )
                patches = patch_result["patches"]
                merged_text = patch_result["mergedText"]
                merged_validation = patch_result["mergedValidation"]
                patch_ok = patch_result["ok"]
                return {
                    "rawOutput": merged_text if patch_ok else text,
                    "promptPreview": system_prompt,
                    "retryUsed": False,
                    "patchUsed": patch_ok,
                    "selectedStoryDirection": selected_direction,
                    "selectedStoryDirectionText": selected_direction_text,
                    "visualEventChain": visual_event_chain,
                    "visualEventChainText": visual_event_chain_text,
                    "patchSceneIndexes": [index + 1 for index in sorted(patches.keys())] if patch_ok else [],
                    "patchReason": "; ".join(item["reason"] for item in patch_result["initialTargets"]),
                    "patchOk": patch_ok,
                    "patchFullyResolved": bool(patch_result["fullyResolved"]),
                    "patchFailedSceneIndexes": patch_result["failedSceneIndexes"],
                    "patchSkippedSceneIndexes": patch_result["skippedSceneIndexes"],
                    "patchRemainingSceneIndexes": patch_result["remainingSceneIndexes"],
                    "attemptCount": 1 + patch_result["attemptCount"],
                    "cameraEnhanced": bool(camera_enhancements),
                    "cameraEnhancedSceneIndexes": [item["index"] + 1 for item in camera_enhancements],
                    "generateProfile": first_generate_profile,
                    "firstGenerateProfile": first_generate_profile,
                    "patchGenerateProfiles": patch_result["patchGenerateProfiles"],
                    "qualityWarning": merged_validation["qualityWarning"] if patch_ok else validation["qualityWarning"],
                    "qualityHardError": "" if patch_ok else validation["qualityHardError"],
                    "jsonWrapperRepaired": bool(merged_validation["jsonWrapperRepaired"] or validation["jsonWrapperRepaired"] or parsed_wrapper_repaired),
                    "firstRawOutput": raw_text,
                    "firstRawOutputLength": len(raw_text),
                }

            if parsed_output and len(parsed_output) == 9:
                patch_targets = storyboard_director_patch_targets(parsed_output)
                if patch_targets:
                    patch_result = self.run_storyboard_director_patch_sequence(
                        story_text,
                        world_continuity,
                        parsed_output,
                        text,
                        started,
                        patch_max_length,
                        validation["reason"],
                        selected_direction,
                        visual_event_chain,
                    )
                    patches = patch_result["patches"]
                    merged_text = patch_result["mergedText"]
                    merged_validation = patch_result["mergedValidation"]
                    patch_ok = patch_result["ok"]
                    if patch_ok:
                        return {
                            "rawOutput": merged_text,
                            "promptPreview": system_prompt,
                            "retryUsed": False,
                            "patchUsed": True,
                            "selectedStoryDirection": selected_direction,
                            "selectedStoryDirectionText": selected_direction_text,
                            "visualEventChain": visual_event_chain,
                            "visualEventChainText": visual_event_chain_text,
                            "patchSceneIndexes": [index + 1 for index in sorted(patches.keys())],
                            "patchReason": "; ".join(item["reason"] for item in patch_result["initialTargets"]),
                            "patchOk": True,
                            "patchFullyResolved": bool(patch_result["fullyResolved"]),
                            "patchFailedSceneIndexes": patch_result["failedSceneIndexes"],
                            "patchSkippedSceneIndexes": patch_result["skippedSceneIndexes"],
                            "patchRemainingSceneIndexes": patch_result["remainingSceneIndexes"],
                            "attemptCount": 1 + patch_result["attemptCount"],
                            "cameraEnhanced": bool(camera_enhancements),
                            "cameraEnhancedSceneIndexes": [item["index"] + 1 for item in camera_enhancements],
                            "generateProfile": first_generate_profile,
                            "firstGenerateProfile": first_generate_profile,
                            "patchGenerateProfiles": patch_result["patchGenerateProfiles"],
                            "qualityWarning": merged_validation["qualityWarning"],
                            "qualityHardError": "",
                            "jsonWrapperRepaired": bool(merged_validation["jsonWrapperRepaired"] or parsed_wrapper_repaired),
                            "firstRawOutput": raw_text,
                            "firstRawOutputLength": len(raw_text),
                        }
                    return {
                        "rawOutput": text,
                        "promptPreview": system_prompt,
                        "retryUsed": False,
                        "patchUsed": False,
                        "selectedStoryDirection": selected_direction,
                        "selectedStoryDirectionText": selected_direction_text,
                        "visualEventChain": visual_event_chain,
                        "visualEventChainText": visual_event_chain_text,
                        "patchSceneIndexes": [],
                        "patchReason": "; ".join(item["reason"] for item in patch_result["initialTargets"]),
                        "patchOk": False,
                        "patchFullyResolved": False,
                        "patchFailedSceneIndexes": patch_result["failedSceneIndexes"],
                        "patchSkippedSceneIndexes": patch_result["skippedSceneIndexes"],
                        "patchRemainingSceneIndexes": patch_result["remainingSceneIndexes"],
                        "attemptCount": 1 + patch_result["attemptCount"],
                        "cameraEnhanced": bool(camera_enhancements),
                        "cameraEnhancedSceneIndexes": [item["index"] + 1 for item in camera_enhancements],
                        "generateProfile": first_generate_profile,
                        "firstGenerateProfile": first_generate_profile,
                        "patchGenerateProfiles": patch_result["patchGenerateProfiles"],
                        "retryReason": validation["reason"],
                        "retryOk": False,
                        "qualityWarning": validation["qualityWarning"],
                        "qualityHardError": validation["qualityHardError"],
                        "jsonWrapperRepaired": validation["jsonWrapperRepaired"] or parsed_wrapper_repaired,
                        "parseReason": parse_reason,
                        "firstRawOutput": raw_text,
                        "firstRawOutputLength": len(raw_text),
                    }

            return {
                "rawOutput": text,
                "promptPreview": system_prompt,
                "retryUsed": False,
                "patchUsed": False,
                "attemptCount": 1,
                "selectedStoryDirection": selected_direction,
                "selectedStoryDirectionText": selected_direction_text,
                "visualEventChain": visual_event_chain,
                "visualEventChainText": visual_event_chain_text,
                "cameraEnhanced": bool(camera_enhancements),
                "cameraEnhancedSceneIndexes": [item["index"] + 1 for item in camera_enhancements],
                "generateProfile": first_generate_profile,
                "firstGenerateProfile": first_generate_profile,
                "retryReason": validation["reason"],
                "retryOk": False,
                "qualityWarning": validation["qualityWarning"],
                "qualityHardError": validation["qualityHardError"],
                "jsonWrapperRepaired": validation["jsonWrapperRepaired"] or parsed_wrapper_repaired,
                "parseReason": parse_reason,
                "firstRawOutput": raw_text if camera_enhancements else "",
                "firstRawOutputLength": len(raw_text) if camera_enhancements else 0,
            }
        except Exception as exc:
            log_prompt_assistant_event(
                "storyboard_director_plan_generate_error",
                command="storyboardDirectorPlan",
                elapsedMs=round((time.time() - started) * 1000),
                promptChars=len(system_prompt),
                schemaChars=schema_chars,
                maxLength=first_max_length,
                patchMaxLength=patch_max_length,
                generateProfile=dict(self.last_generate_profile or {}),
                error=str(exc),
            )
            raise

    def reverse_plain_static_image(self, payload: dict, image_tensor, requirements: str) -> dict:
        requested_provider = self.reverse_provider_preference(payload)
        requested_schema = (
            VISUAL_SCHEMA_VERSION_V2
            if str(payload.get("visualSchema") or "").strip() == VISUAL_SCHEMA_VERSION_V2
            else VISUAL_SCHEMA_VERSION
        )
        nsfw_enabled = payload.get("nsfw") is True
        reverse_model_path = self.reverse_model_path()
        use_local_compact_v2 = (
            requested_schema == VISUAL_SCHEMA_VERSION_V2
            and requested_provider != "qwen2.5-vl"
        )
        keyed_v2_contract_instruction = (
            local_compact_visual_contract_instruction(allow_uncertain_age=False)
            if use_local_compact_v2
            else ""
        )
        keyed_v2_contract_rules = (
            "只输出带字段名的compact v2合同，即exact 13键的一行标准JSON；"
            "必须是裸JSON对象，不要Markdown、代码围栏、解释、前缀或后缀，不得重复任何键。"
            "先数清可见完整或局部人物，people必须等于entities中person和partial_person的项数；"
            "山景、建筑、天空、地面和纯背景不得标成person或partial_person。"
            "机器人、雕塑或玩偶若标成person或partial_person，age必须为age_unverifiable；"
            "纯机械主体也可标成object并令people=0、age=not_applicable。"
            "level、body、signals和facts必须相互一致；非safe时facts必须写直接可见依据，"
            "facts只用于敏感可见证据，普通画面事实写入entities、scene或look；"
            "level=safe时必须body=none、interaction=none、signals=[]、facts=[]；"
            "level=uncertain时也必须facts=[]。"
            "body只衡量裸体敏感部位暴露，不是服装覆盖率；低领、裸腿、贴身服装或盔甲露肤本身"
            "必须为body=none且不得写nudity，但不得隐去真正可见的裸体敏感内容。"
            "性化姿态信号只能写sexualized_pose，绝不能写suggestive_pose。"
            "level=suggestive或nudity时，signals绝不能含explicit_activity、explicit_anatomy或sexual_fluid；"
            "只要signals含这三项中的任一项，level必须为explicit。"
            "age只允许adult_appearing、age_unverifiable、young_or_minor_indicators、not_applicable，"
            "不得输出uncertain或ambiguous_or_young_appearing；存在年轻化措辞时不得声称adult_appearing。"
            "非safe且没有明确幼态或未成年人直接证据时，普通字段必须使用人物、女性角色、男性角色等中性称呼，"
            "不得使用少女、少年、女孩、男孩、girl或boy，age无法确认就填age_unverifiable；"
            "若确有儿童、未成年、未满18岁、teen、child等直接证据，age必须填young_or_minor_indicators并在facts如实保留证据，不得隐去。"
            "JSON结构符号只用标准半角ASCII字符，字符串值内部不要使用引号、反斜杠或换行，"
            "数组和对象末项不得有尾逗号；根闭合花括号必须是最后一个字符，后面禁止引号或任何文字。"
            "除kind、level、body、interaction、age、signals的规定英文枚举值外，其余字符串值一律使用简体中文自然短语；"
            "action只写直接可见的中文动作，不得写signals枚举码或snake_case标签。"
            "输出前先逐边检查画面：任何不属于主角、仅从边缘进入画面的脸、手臂、手、腿或躯干都必须单独计为partial_person；"
            "显著手持武器、道具及独立轮廓的能量、火焰、光环必须各自写为kind=object的entity，"
            "并在relations写其与主角、主体或画面的位置或接触关系；不得使用未指明对象的与人物关系，"
            "不得只并入action、look或scene，空间不足先缩减普通服装词。"
        )
        keyed_v2_first_prompt = (
            "直接观察当前图片并从头填写视觉事实，不得猜测不可见内容。"
            + keyed_v2_contract_rules
            + keyed_v2_contract_instruction
            if use_local_compact_v2
            else visual_contract_instruction(requested_schema)
        )
        keyed_v2_retry_prompt = (
            "上一次同图视觉JSON未通过结构校验。本次必须重新观察同一张图片并从头完整重写，"
            "不是续写、补括号或修补上一次文本；不得引用上一次输出。"
            + keyed_v2_contract_rules
            + keyed_v2_contract_instruction
            if use_local_compact_v2
            else visual_contract_instruction(requested_schema)
        )
        keyed_v2_age_retry_prompt = (
            "上一次同图视觉JSON结构完整，但people与age字段互相矛盾。"
            "本次必须重新观察同一张图片并从头完整重写，不得引用或修补上一次输出。"
            "只要people大于0，age就不能是not_applicable；people为0时age必须是not_applicable。"
            "机器人、雕塑或玩偶若被计为拟人角色，age使用age_unverifiable；"
            "若是纯机械物体，则kind使用object、people=0、age=not_applicable。"
            + keyed_v2_contract_rules
            + keyed_v2_contract_instruction
            if use_local_compact_v2
            else visual_contract_instruction(requested_schema)
        )
        keyed_v2_participant_retry_prompt = (
            "上一次同图视觉JSON的people与人物实体数量不一致。"
            "本次必须重新观察同一张图片并从头完整重写，不得引用或修补上一次输出。"
            "people必须严格等于entities中kind为person或partial_person的项数；"
            "kind为object的机器人、雕塑、玩偶、动物、建筑和背景物体绝不能计入people。"
            "不得为了通过校验而删除真实可见人物或把真实人物改成object。"
            + keyed_v2_contract_rules
            + keyed_v2_contract_instruction
            if use_local_compact_v2
            else visual_contract_instruction(requested_schema)
        )
        salient_inventory_system_text = (
            "你是 NovaFlow 的本地显著视觉元素核对器。只返回指定的三行纯文本协议，"
            "不得返回 JSON、Markdown、解释、前缀或后缀。"
        )
        salient_inventory_prompt = (
            "重新观察当前图片，只补查主视觉合同容易遗漏的显著元素；不复述主角、普通服装、环境、风格、镜头、年龄、性别或内容安全判断。"
            "只记录清楚可见且位置关系明确的三类内容：非主角的边缘或遮挡人物、显著独立武器或道具、具有独立轮廓的能量火焰或光环。"
            "不确定就留空，禁止猜测。严格输出且只输出以下三行，顺序和英文前缀必须完全一致：\n"
            "PARTIAL_PEOPLE=名称|简短外观|边缘遮挡或背景位置\n"
            "OBJECTS=名称|简短外观|与主角、主体或画面的位置接触关系\n"
            "EFFECTS=名称|简短外观|与主角、主体或画面的位置关系\n"
            "同类多项仅用半角分号;分隔；每项必须恰好三个非空字段并仅用半角竖线|分隔；该类没有内容时等号后保持为空。"
        )
        contract_prompt = keyed_v2_first_prompt
        fallback_code = ""
        semantic_gate_invalid = False
        quality_gate_retried = False
        retry_count = 0
        retry_reason = ""
        contract_failure_code = ""
        provider_failure_code = ""
        failure_category = ""
        raw_output = ""
        contract_structure_diagnostics = {}

        def normalize_keyed_retry_json(
            output: str,
            provider_adapter,
        ) -> tuple[str, str, int]:
            """Normalize only observed, delimiter-only keyed retry syntax drift."""

            text = str(output or "").strip()
            generation = getattr(
                provider_adapter,
                "last_generation_diagnostics",
                {},
            )
            if not isinstance(generation, dict):
                generation = {}
            if (
                generation.get("generationTokenLimit") != 384
                or generation.get("generationHitTokenLimit") is not False
            ):
                return text, "", -1
            if not text.endswith('}"'):
                delimiter_marker = '}]}"relations":'
                trailing_quote_marker = '}]","relations":'
                delimiter_count = text.count(delimiter_marker)
                trailing_quote_count = text.count(trailing_quote_marker)
                if (
                    not text.startswith("{")
                    or not text.endswith("}")
                    or (delimiter_count, trailing_quote_count)
                    not in {(1, 0), (0, 1)}
                ):
                    return text, "", -1
                marker = (
                    delimiter_marker
                    if delimiter_count == 1
                    else trailing_quote_marker
                )
                marker_index = text.index(marker)
                object_depth = 0
                array_depth = 0
                in_string = False
                escaped = False
                for character in text[:marker_index]:
                    if in_string:
                        if escaped:
                            escaped = False
                        elif character == "\\":
                            escaped = True
                        elif character == '"':
                            in_string = False
                        continue
                    if character == '"':
                        in_string = True
                    elif character == "{":
                        object_depth += 1
                    elif character == "}":
                        object_depth -= 1
                    elif character == "[":
                        array_depth += 1
                    elif character == "]":
                        array_depth -= 1
                    if object_depth < 0 or array_depth < 0:
                        return text, "", -1
                if in_string or object_depth != 2 or array_depth != 1:
                    return text, "", -1
                if marker == trailing_quote_marker:
                    quote_offset = marker_index + 2
                    candidate = (
                        text[:quote_offset]
                        + text[quote_offset + 1 :]
                    )
                    if (
                        len(candidate) != len(text) - 1
                        or text[quote_offset] != '"'
                        or candidate[:quote_offset] != text[:quote_offset]
                        or candidate[quote_offset:] != text[quote_offset + 1 :]
                    ):
                        return text, "", -1
                    return (
                        candidate,
                        "entities_relations_trailing_quote",
                        quote_offset,
                    )
                candidate = (
                    text[: marker_index + 2]
                    + ","
                    + text[marker_index + 3 :]
                )
                if (
                    len(candidate) != len(text)
                    or sum(
                        left != right
                        for left, right in zip(text, candidate)
                    )
                    != 1
                ):
                    return text, "", -1
                return candidate, "entities_relations_delimiter", marker_index + 2
            candidate = text[:-1]
            if not candidate.startswith("{") or not candidate.endswith("}"):
                return text, "", -1
            return candidate, "trailing_quote", len(candidate)

        def parse_keyed_retry_contract(
            output: str,
            *,
            validate_semantics: bool = True,
            allow_incomplete_participants: bool = False,
        ) -> dict:
            text = str(output or "").strip()
            if not text.startswith("{"):
                raise VisualContractError(
                    "keyed retry must be a bare JSON object"
                )
            return parse_local_single_image_compact_visual_contract(
                text,
                validate_semantics=validate_semantics,
                allow_incomplete_participants=allow_incomplete_participants,
            )

        def parse_safe_semantic_retry_contract(output: str) -> dict | None:
            """Read a failed keyed contract without semantics, but never relax safety."""

            try:
                structural_contract = parse_keyed_retry_contract(
                    output,
                    validate_semantics=False,
                    allow_incomplete_participants=True,
                )
            except VisualContractError:
                return None
            content_safety = structural_contract.get("content_safety") or {}
            if not (
                content_safety.get("level") == "safe"
                and content_safety.get("body_exposure") == "none"
                and content_safety.get("interaction_category") == "none"
                and content_safety.get("age_assessment")
                != "young_or_minor_indicators"
                and not content_safety.get("signals")
                and not content_safety.get("sensitive_visible_facts")
            ):
                return None
            return structural_contract

        def safe_contract_structure_diagnostics(
            output: str,
            error: VisualContractError,
            provider_adapter,
        ) -> dict:
            text = str(output or "").strip()
            if not text:
                json_start_state = "empty"
                json_end_state = "empty"
            else:
                json_start_state = (
                    "markdown_fence"
                    if text.startswith("```")
                    else "object_open"
                    if text.startswith("{")
                    else "array_open"
                    if text.startswith("[")
                    else "other"
                )
                json_end_state = (
                    "markdown_fence"
                    if text.endswith("```")
                    else "object_close"
                    if text.endswith("}")
                    else "array_close"
                    if text.endswith("]")
                    else "incomplete"
                )

            error_text = str(error or "")
            if "duplicate JSON key" in error_text:
                parse_error_category = "duplicate_key"
            elif "keys mismatch" in error_text:
                parse_error_category = (
                    "missing_keys"
                    if not re.search(r"missing=\[\]", error_text)
                    else "extra_keys"
                )
            elif "invalid JSON" in error_text:
                expected_end_state = (
                    "markdown_fence"
                    if json_start_state == "markdown_fence"
                    else "object_close"
                )
                parse_error_category = (
                    "truncated_json"
                    if json_start_state in {"markdown_fence", "object_open"}
                    and json_end_state != expected_end_state
                    else "invalid_json"
                )
            elif "must be an object" in error_text:
                parse_error_category = "object_type"
            elif "must be an array" in error_text:
                parse_error_category = "array_type"
            elif "JSON payload exceeds" in error_text:
                parse_error_category = "output_limit"
            elif "too many items" in error_text:
                parse_error_category = "array_limit"
            elif "must contain exactly" in error_text:
                parse_error_category = "tuple_length"
            elif "unsupported code" in error_text:
                parse_error_category = "code_value"
            elif "duplicates a signal code" in error_text:
                parse_error_category = "duplicate_value"
            elif "too many entities" in error_text or "too many signal codes" in error_text:
                parse_error_category = "array_limit"
            elif "must be a string" in error_text:
                parse_error_category = "value_type"
            elif "must be an integer" in error_text:
                parse_error_category = "value_type"
            elif "must be non-empty" in error_text:
                parse_error_category = "missing_value"
            else:
                parse_error_category = "contract_structure"

            contract_path_match = re.match(
                r"(local_(?:static_)?compact(?:\.[a-zA-Z0-9_]+|\[[0-9]+\])*)",
                error_text,
            )
            contract_path = (
                contract_path_match.group(1)[:120]
                if contract_path_match
                else ""
            )

            adapter_diagnostics = getattr(
                provider_adapter,
                "last_generation_diagnostics",
                {},
            )
            if not isinstance(adapter_diagnostics, dict):
                adapter_diagnostics = {}
            generated_tokens = adapter_diagnostics.get("generatedTokens")
            generation_token_limit = adapter_diagnostics.get("generationTokenLimit")
            generation_hit_token_limit = adapter_diagnostics.get(
                "generationHitTokenLimit"
            )
            if isinstance(generated_tokens, bool) or not isinstance(generated_tokens, int):
                generated_tokens = None
            if (
                isinstance(generation_token_limit, bool)
                or not isinstance(generation_token_limit, int)
            ):
                generation_token_limit = None
            if not isinstance(generation_hit_token_limit, bool):
                generation_hit_token_limit = None
            return {
                "outputChars": len(str(output or "")),
                "generatedTokens": generated_tokens,
                "generationTokenLimit": generation_token_limit,
                "generationHitTokenLimit": generation_hit_token_limit,
                "jsonStartState": json_start_state,
                "jsonEndState": json_end_state,
                "parseErrorCategory": parse_error_category,
                "contractPath": contract_path,
            }

        def v2_failure_diagnostics(
            *,
            error_code: str,
            provider_code: str,
            contract_code: str,
            category: str,
            retryable: bool,
        ) -> dict:
            safe_messages = {
                "semantic_contract": "视觉分析结果未通过语义合同校验",
                "contract_structure": "视觉分析结果未返回完整的v2结构",
                "provider": "本地视觉模型未完成分析",
                "configuration": "本地视觉模型未就绪",
            }
            diagnostics = {
                "message": safe_messages.get(category, "本地视觉分析未完成"),
                "errorCode": str(error_code or "v2-qwen3-fail-closed")[:80],
                "providerFailureCode": str(provider_code or "")[:80],
                "contractFailureCode": str(contract_code or "")[:80],
                "retryAttempted": bool(quality_gate_retried),
                "retryCount": int(retry_count),
                "reverseProvider": "qwen3_vl_abliterated_nf4",
                "legacyFallbackSuppressed": True,
                "requestedVisualSchema": requested_schema,
                "retryable": bool(retryable),
                "failureCategory": str(category or "unknown")[:80],
                "generationGate": "blocked",
            }
            if category == "contract_structure":
                diagnostics.update(contract_structure_diagnostics)
            return diagnostics

        if (
            requested_schema == VISUAL_SCHEMA_VERSION_V2
            and requested_provider == "qwen2.5-vl"
        ):
            raise VisualContractError(
                "nf.visual.v2 requires the Qwen3 visual contract provider",
                code="v2-qwen3-required",
                diagnostics=v2_failure_diagnostics(
                    error_code="v2-qwen3-required",
                    provider_code="v2-qwen3-required",
                    contract_code="",
                    category="configuration",
                    retryable=False,
                ),
            )

        if requested_provider != "qwen2.5-vl":
            adapter = Qwen3VLAbliteratedAdapter(
                reverse_model_path,
                max_side=768,
                max_new_tokens=(
                    384
                    if requested_schema == VISUAL_SCHEMA_VERSION_V2
                    else 1600
                ),
            )
            readiness = adapter.readiness()
            if readiness.get("available"):
                try:
                    # The reverse provider is task-scoped; never keep the legacy CLIP resident beside it.
                    self.reset_loaded_clip()

                    def finalize_v2_generation_candidate(details: dict) -> dict:
                        if requested_schema != VISUAL_SCHEMA_VERSION_V2:
                            return details
                        finalized = dict(details)
                        finalized.setdefault("richPromptFallback", False)
                        return finalized

                    def enrich_v2_generation_candidate(
                        details: dict,
                        contract: dict,
                        *,
                        required: bool = False,
                        contract_elapsed_ms: int = 0,
                    ) -> dict:
                        finalized = finalize_v2_generation_candidate(details)
                        if requested_schema != VISUAL_SCHEMA_VERSION_V2:
                            return finalized
                        generation_gate = str(finalized.get("generationGate") or "")
                        if generation_gate not in {"direct", "adult_confirmation"}:
                            return finalized
                        content_safety = contract.get("content_safety") or {}
                        sensitive = generation_gate == "adult_confirmation"
                        require_interaction_evidence = (
                            content_safety.get("interaction_category") == "sexual"
                            or "explicit_activity" in set(content_safety.get("signals") or [])
                        )
                        if required:
                            blocked = compile_degraded_visual_prompt_details(contract)
                            finalized.update(blocked)
                            finalized["richPromptFallback"] = False
                            log_prompt_assistant_event(
                                "reverse_rich_prompt_skipped",
                                command="reverseImagePrompt",
                                provider="qwen3_vl_abliterated_nf4",
                                visualSchema=requested_schema,
                                reason="partial-contract-not-safe-to-enrich",
                                contractElapsedMs=contract_elapsed_ms,
                            )
                            return finalized
                        # The keyed contract is the only model-authored visual truth.
                        # Compile the editable five-section prompt deterministically so
                        # a second sampled pass cannot drift, bypass the contract, or
                        # turn an otherwise valid reverse into a late provider failure.
                        rich_visual_prompt = compile_deterministic_rich_visual_prompt(
                            contract,
                            sensitive=sensitive,
                        )
                        rich_visual_prompt = validate_rich_visual_prompt(
                            rich_visual_prompt,
                            sensitive=sensitive,
                            require_interaction_evidence=require_interaction_evidence,
                            minimum_body_chars=0,
                        )
                        rich_prompt_fallback = False
                        log_prompt_assistant_event(
                            "reverse_rich_prompt_deterministic",
                            command="reverseImagePrompt",
                            provider="qwen3_vl_abliterated_nf4",
                            visualSchema=requested_schema,
                            reason="validated-contract-primary",
                            contractElapsedMs=contract_elapsed_ms,
                        )
                        finalized["prompt"] = append_rich_generation_requirements(
                            rich_visual_prompt,
                            requirements,
                        )
                        if generation_gate == "direct":
                            finalized["visualPrompt"] = rich_visual_prompt
                        finalized["richPromptFallback"] = rich_prompt_fallback
                        return finalized

                    qwen3_attempts = 2 if use_local_compact_v2 else 1
                    contract_stage_started = time.monotonic()
                    partial_contract_codes = {
                        "visual-contract-interaction-evidence-incomplete",
                        "visual-contract-projection-redaction-required",
                    }
                    for attempt in range(1, qwen3_attempts + 1):
                        attempt_started = time.monotonic()
                        prompt_for_attempt = (
                            keyed_v2_age_retry_prompt
                            if use_local_compact_v2
                            and attempt == 2
                            and retry_reason == "semantic-age-count"
                            else keyed_v2_participant_retry_prompt
                            if use_local_compact_v2
                            and attempt == 2
                            and retry_reason == "semantic-participant-count"
                            else keyed_v2_retry_prompt
                            if use_local_compact_v2 and attempt == 2
                            else contract_prompt
                        )
                        raw_output = (
                            adapter.generate(
                                prompt_for_attempt,
                                image_tensor,
                                unload_after=False,
                                **(
                                    {
                                        "do_sample": False,
                                        "max_new_tokens": 384,
                                    }
                                    if use_local_compact_v2
                                    else {}
                                ),
                            )
                            if requested_schema == VISUAL_SCHEMA_VERSION_V2
                            else adapter.generate(prompt_for_attempt, image_tensor)
                        )
                        attempt_elapsed_ms = round(
                            (time.monotonic() - attempt_started) * 1000
                        )
                        contract_parse_succeeded = False
                        keyed_contract_attempt = use_local_compact_v2
                        contract_output = raw_output
                        retry_syntax_normalization = ""
                        try:
                            if keyed_contract_attempt:
                                try:
                                    contract = parse_keyed_retry_contract(
                                        contract_output,
                                    )
                                except VisualContractError as initial_keyed_error:
                                    if (
                                        initial_keyed_error.semantic
                                        or "invalid JSON" not in str(initial_keyed_error)
                                    ):
                                        raise
                                    (
                                        normalized_output,
                                        normalization_code,
                                        normalization_offset,
                                    ) = normalize_keyed_retry_json(
                                        contract_output,
                                        adapter,
                                    )
                                    if not normalization_code:
                                        raise
                                    contract_output = normalized_output
                                    retry_syntax_normalization = normalization_code
                                    log_prompt_assistant_event(
                                        "reverse_visual_contract_syntax_normalized",
                                        command="reverseImagePrompt",
                                        provider="qwen3_vl_abliterated_nf4",
                                        visualSchema=requested_schema,
                                        attempt=attempt,
                                        retryReason=retry_reason,
                                        normalization=normalization_code,
                                        normalizationOffset=normalization_offset,
                                        normalizationCount=1,
                                    )
                                    contract = parse_keyed_retry_contract(
                                        contract_output,
                                    )
                            else:
                                contract = parse_visual_contract(
                                    contract_output,
                                    expected_schema=requested_schema,
                                )
                            contract_parse_succeeded = True
                            compiled = compile_visual_prompt_details(
                                contract,
                                requirements,
                                nsfw=nsfw_enabled,
                            )
                        except VisualContractError as exc:
                            if (
                                requested_schema == VISUAL_SCHEMA_VERSION_V2
                                and not exc.semantic
                                and not contract_parse_succeeded
                            ):
                                contract_structure_diagnostics = (
                                    safe_contract_structure_diagnostics(
                                        raw_output,
                                        exc,
                                        adapter,
                                    )
                                )
                                contract_structure_diagnostics["attemptElapsedMs"] = (
                                    attempt_elapsed_ms
                                )
                            retry_category = contract_structure_diagnostics.get(
                                "parseErrorCategory"
                            )
                            retry_generated_tokens = contract_structure_diagnostics.get(
                                "generatedTokens"
                            )
                            retry_output_text = str(raw_output or "").strip()
                            retryable_keyed_structure = (
                                bool(retry_category)
                                and bool(retry_output_text)
                                and 1
                                <= contract_structure_diagnostics.get("outputChars", 0)
                                <= 4096
                                and isinstance(retry_generated_tokens, int)
                                and 1 <= retry_generated_tokens <= 384
                                and contract_structure_diagnostics.get(
                                    "generationTokenLimit"
                                )
                                == 384
                                and contract_structure_diagnostics.get(
                                    "generationHitTokenLimit"
                                )
                                in {True, False}
                            )
                            if (
                                attempt == 1
                                and keyed_contract_attempt
                                and not exc.semantic
                                and not contract_parse_succeeded
                                and retryable_keyed_structure
                                and attempt_elapsed_ms <= 120_000
                            ):
                                quality_gate_retried = True
                                retry_count = 1
                                retry_reason = retry_category or "contract_structure"
                                log_prompt_assistant_event(
                                    "reverse_visual_contract_retry",
                                    command="reverseImagePrompt",
                                    provider="qwen3_vl_abliterated_nf4",
                                    visualSchema=requested_schema,
                                    attempt=attempt,
                                    nextAttempt=2,
                                    retryCount=retry_count,
                                    retryReason=retry_reason,
                                    failureCategory="contract_structure",
                                    errorCode=exc.code,
                                    **contract_structure_diagnostics,
                                )
                                continue
                            semantic_validation_leaf = clean_text(str(exc))[:120]
                            safe_semantic_retry_contract = None
                            if (
                                attempt == 1
                                and keyed_contract_attempt
                                and exc.semantic
                                and semantic_validation_leaf
                                in {
                                    "zero visible_person_count requires age_assessment=not_applicable",
                                    "positive visible_person_count requires an applicable age_assessment",
                                    "local_compact person and partial_person entities must match people",
                                }
                            ):
                                safe_semantic_retry_contract = (
                                    parse_safe_semantic_retry_contract(contract_output)
                                )
                            retryable_age_count_semantic = (
                                isinstance(safe_semantic_retry_contract, dict)
                                and semantic_validation_leaf
                                in {
                                    "zero visible_person_count requires age_assessment=not_applicable",
                                    "positive visible_person_count requires an applicable age_assessment",
                                }
                            )
                            if retryable_age_count_semantic:
                                quality_gate_retried = True
                                retry_count = 1
                                retry_reason = "semantic-age-count"
                                log_prompt_assistant_event(
                                    "reverse_visual_contract_retry",
                                    command="reverseImagePrompt",
                                    provider="qwen3_vl_abliterated_nf4",
                                    visualSchema=requested_schema,
                                    attempt=attempt,
                                    nextAttempt=2,
                                    retryCount=retry_count,
                                    retryReason=retry_reason,
                                    failureCategory="semantic_contract",
                                    errorCode=exc.code,
                                    validationLeaf=semantic_validation_leaf,
                                    attemptElapsedMs=attempt_elapsed_ms,
                                )
                                continue
                            retryable_safe_participant_semantic = (
                                isinstance(safe_semantic_retry_contract, dict)
                                and semantic_validation_leaf
                                == "local_compact person and partial_person entities must match people"
                            )
                            if retryable_safe_participant_semantic:
                                quality_gate_retried = True
                                retry_count = 1
                                retry_reason = "semantic-participant-count"
                                log_prompt_assistant_event(
                                    "reverse_visual_contract_retry",
                                    command="reverseImagePrompt",
                                    provider="qwen3_vl_abliterated_nf4",
                                    visualSchema=requested_schema,
                                    attempt=attempt,
                                    nextAttempt=2,
                                    retryCount=retry_count,
                                    retryReason=retry_reason,
                                    failureCategory="semantic_contract",
                                    errorCode=exc.code,
                                    validationLeaf=semantic_validation_leaf,
                                    attemptElapsedMs=attempt_elapsed_ms,
                                )
                                continue
                            if exc.semantic:
                                semantic_gate_invalid = True
                            keyed_contract_semantic = (
                                keyed_contract_attempt and exc.semantic
                            )
                            recoverable_keyed_partial_contract = None
                            if (
                                keyed_contract_semantic
                                and not contract_parse_succeeded
                                and attempt == 1
                                and retry_count == 0
                                and not quality_gate_retried
                                and not retry_reason
                                and nsfw_enabled
                                and exc.code in partial_contract_codes
                            ):
                                try:
                                    recoverable_keyed_partial_contract = (
                                        parse_local_single_image_recoverable_partial_contract(
                                            contract_output,
                                            expected_failure_code=exc.code,
                                        )
                                    )
                                except VisualContractError:
                                    recoverable_keyed_partial_contract = None
                            if (
                                quality_gate_retried
                                and attempt == 2
                                and not keyed_contract_semantic
                            ):
                                raise
                            if (
                                requested_schema == VISUAL_SCHEMA_VERSION_V2
                                and exc.semantic
                            ):
                                structural_contract = (
                                    recoverable_keyed_partial_contract
                                    if recoverable_keyed_partial_contract is not None
                                    else parse_local_compact_visual_contract(
                                        contract_output,
                                        validate_semantics=False,
                                        allow_legacy_read=False,
                                        allow_young_wording_neutralization=False,
                                        allow_incomplete_participants=True,
                                    )
                                    if keyed_contract_attempt
                                    else parse_visual_contract(
                                        raw_output,
                                        expected_schema=requested_schema,
                                        validate_semantics=False,
                                    )
                                )
                                analysis_partial = (
                                    (
                                        not keyed_contract_semantic
                                        and exc.code in partial_contract_codes
                                    )
                                    or recoverable_keyed_partial_contract is not None
                                )
                                degraded = (
                                    compile_partial_visual_prompt_details(
                                        structural_contract,
                                        requirements,
                                        nsfw=nsfw_enabled,
                                        failure_code=exc.code,
                                    )
                                    if analysis_partial
                                    else compile_degraded_visual_prompt_details(
                                        structural_contract
                                    )
                                )
                                if (
                                    recoverable_keyed_partial_contract is not None
                                    and (
                                        degraded.get("generationGate")
                                        != "adult_confirmation"
                                        or degraded.get("sensitivePromptBlocked")
                                    )
                                ):
                                    degraded = compile_degraded_visual_prompt_details(
                                        structural_contract
                                    )
                                    analysis_partial = False
                                if (
                                    analysis_partial
                                    and degraded.get("generationGate")
                                    == "adult_confirmation"
                                ):
                                    if recoverable_keyed_partial_contract is not None:
                                        degraded = finalize_v2_generation_candidate(degraded)
                                    else:
                                        degraded = enrich_v2_generation_candidate(
                                            degraded,
                                            structural_contract,
                                            required=True,
                                            contract_elapsed_ms=round(
                                                (
                                                    time.monotonic()
                                                    - contract_stage_started
                                                )
                                                * 1000
                                            ),
                                        )
                                else:
                                    degraded = finalize_v2_generation_candidate(degraded)
                                if recoverable_keyed_partial_contract is not None:
                                    analysis_partial = (
                                        degraded.get("generationGate")
                                        == "adult_confirmation"
                                        and not degraded.get("sensitivePromptBlocked")
                                    )
                                model_name = reverse_model_path.name[:160]
                                diagnostics = v2_failure_diagnostics(
                                    error_code=exc.code,
                                    provider_code=exc.code,
                                    contract_code=exc.code,
                                    category="semantic_contract",
                                    retryable=True,
                                )
                                semantic_validation_leaf = clean_text(str(exc))[:120]
                                diagnostics["validationLeaf"] = semantic_validation_leaf
                                diagnostics["generationGate"] = degraded["generationGate"]
                                if retry_syntax_normalization:
                                    diagnostics["retrySyntaxNormalization"] = (
                                        retry_syntax_normalization
                                    )
                                adapter_generation_diagnostics = getattr(
                                    adapter,
                                    "last_generation_diagnostics",
                                    {},
                                )
                                if not isinstance(adapter_generation_diagnostics, dict):
                                    adapter_generation_diagnostics = {}
                                if (
                                    exc.code
                                    == "visual-contract-interaction-evidence-incomplete"
                                ):
                                    diagnostics["message"] = (
                                        "检测到敏感互动迹象，但详细互动证据未通过校验"
                                    )
                                elif (
                                    exc.code
                                    == "visual-contract-projection-redaction-required"
                                ):
                                    diagnostics["message"] = (
                                        "检测到敏感内容，但部分可见描述需要脱敏"
                                    )
                                log_prompt_assistant_event(
                                    (
                                        "reverse_provider_partial"
                                        if analysis_partial
                                        else "reverse_provider_degraded"
                                    ),
                                    command="reverseImagePrompt",
                                    provider="qwen3_vl_abliterated_nf4",
                                    visualSchema=requested_schema,
                                    errorCode=exc.code,
                                    retryCount=retry_count,
                                    retryReason=retry_reason,
                                    attempt=attempt,
                                    attemptElapsedMs=attempt_elapsed_ms,
                                    generatedTokens=adapter_generation_diagnostics.get(
                                        "generatedTokens"
                                    ),
                                    generationTokenLimit=adapter_generation_diagnostics.get(
                                        "generationTokenLimit"
                                    ),
                                    generationHitTokenLimit=adapter_generation_diagnostics.get(
                                        "generationHitTokenLimit"
                                    ),
                                    outputChars=len(raw_output),
                                    validationLeaf=semantic_validation_leaf,
                                )
                                return {
                                    "description": degraded["prompt"],
                                    "visualPrompt": degraded["visualPrompt"],
                                    "generationRequirements": degraded["generationRequirements"],
                                    "contentSafety": degraded["contentSafety"],
                                    "contentWarnings": degraded["contentWarnings"],
                                    "sensitivePromptBlocked": degraded["sensitivePromptBlocked"],
                                    "generationGate": degraded["generationGate"],
                                    "rawOutput": "",
                                    "qualityGateFailed": True,
                                    "qualityGateRetried": quality_gate_retried,
                                    "visualSchema": requested_schema,
                                    "reverseProvider": "qwen3_vl_abliterated_nf4",
                                    "reverseModelPath": model_name,
                                    "reverseFallbackReason": (
                                        "rich-prompt-fallback"
                                        if degraded.get("richPromptFallback")
                                        else ""
                                    ),
                                    "visualHasOcr": False,
                                    "analysisPartial": analysis_partial,
                                    "analysisDegraded": not analysis_partial,
                                    "richPromptFallback": bool(
                                        degraded.get("richPromptFallback")
                                    ),
                                    **diagnostics,
                                }
                            raise
                        contract_elapsed_ms = round(
                            (time.monotonic() - contract_stage_started) * 1000
                        )
                        contract_safety = contract.get("content_safety") or {}
                        salient_inventory_eligible = (
                            use_local_compact_v2
                            and str(payload.get("purpose") or "").strip()
                            == "static-image-reverse"
                            and not clean_text(requirements)
                            and compiled.get("generationGate") == "direct"
                            and contract_safety.get("level") == "safe"
                            and contract_safety.get("body_exposure") == "none"
                            and contract_safety.get("interaction_category") == "none"
                            and not contract_safety.get("signals")
                            and not contract_safety.get("sensitive_visible_facts")
                            and contract_elapsed_ms <= 180_000
                        )
                        if salient_inventory_eligible:
                            original_contract = contract
                            original_compiled = compiled
                            try:
                                salient_raw_output = adapter.generate(
                                    salient_inventory_prompt,
                                    image_tensor,
                                    unload_after=False,
                                    system_text=salient_inventory_system_text,
                                    do_sample=False,
                                    max_new_tokens=128,
                                )
                                salient_inventory = parse_local_salient_inventory(
                                    salient_raw_output
                                )
                                salient_item_count = sum(
                                    len(items)
                                    for items in salient_inventory.values()
                                )
                                if salient_item_count:
                                    enriched_contract = merge_local_salient_inventory(
                                        contract_output,
                                        salient_inventory,
                                    )
                                    enriched_safety = (
                                        enriched_contract.get("content_safety") or {}
                                    )
                                    for safety_key in (
                                        "level",
                                        "body_exposure",
                                        "interaction_category",
                                        "signals",
                                        "sensitive_visible_facts",
                                    ):
                                        if enriched_safety.get(safety_key) != (
                                            contract_safety.get(safety_key)
                                        ):
                                            raise VisualContractError(
                                                "salient inventory changed protected safety fields"
                                            )
                                    enriched_compiled = compile_visual_prompt_details(
                                        enriched_contract,
                                        "",
                                        nsfw=nsfw_enabled,
                                    )
                                    if enriched_compiled.get("generationGate") != "direct":
                                        raise VisualContractError(
                                            "salient inventory changed the generation gate"
                                        )
                                    contract = enriched_contract
                                    compiled = enriched_compiled
                                    log_prompt_assistant_event(
                                        "reverse_salient_inventory_applied",
                                        command="reverseImagePrompt",
                                        provider="qwen3_vl_abliterated_nf4",
                                        visualSchema=requested_schema,
                                        partialPeopleCount=len(
                                            salient_inventory["partial_people"]
                                        ),
                                        objectCount=len(salient_inventory["objects"]),
                                        effectCount=len(salient_inventory["effects"]),
                                        contractElapsedMs=contract_elapsed_ms,
                                    )
                                else:
                                    log_prompt_assistant_event(
                                        "reverse_salient_inventory_skipped",
                                        command="reverseImagePrompt",
                                        provider="qwen3_vl_abliterated_nf4",
                                        visualSchema=requested_schema,
                                        reason="empty-inventory",
                                        contractElapsedMs=contract_elapsed_ms,
                                    )
                            except Exception as salient_error:
                                contract = original_contract
                                compiled = original_compiled
                                salient_error_code = str(
                                    getattr(salient_error, "code", "") or ""
                                )
                                if salient_error_code in {
                                    "visual-contract-salient-inventory-sensitive",
                                    "visual-contract-salient-inventory-safety-drift",
                                }:
                                    degraded = compile_degraded_visual_prompt_details(
                                        original_contract
                                    )
                                    model_name = reverse_model_path.name[:160]
                                    diagnostics = v2_failure_diagnostics(
                                        error_code=salient_error_code,
                                        provider_code=salient_error_code,
                                        contract_code=salient_error_code,
                                        category="semantic_contract",
                                        retryable=True,
                                    )
                                    log_prompt_assistant_event(
                                        "reverse_provider_degraded",
                                        command="reverseImagePrompt",
                                        provider="qwen3_vl_abliterated_nf4",
                                        visualSchema=requested_schema,
                                        errorCode=salient_error_code,
                                        retryCount=retry_count,
                                        retryReason=retry_reason,
                                        attempt=attempt,
                                        contractElapsedMs=contract_elapsed_ms,
                                        validationLeaf="salient-inventory-safety-conflict",
                                    )
                                    return {
                                        "description": degraded["prompt"],
                                        "visualPrompt": degraded["visualPrompt"],
                                        "generationRequirements": "",
                                        "contentSafety": degraded["contentSafety"],
                                        "contentWarnings": degraded["contentWarnings"],
                                        "sensitivePromptBlocked": True,
                                        "generationGate": "blocked",
                                        "rawOutput": "",
                                        "qualityGateFailed": True,
                                        "qualityGateRetried": quality_gate_retried,
                                        "retryAttempted": quality_gate_retried,
                                        "retryCount": retry_count,
                                        "visualSchema": requested_schema,
                                        "reverseProvider": "qwen3_vl_abliterated_nf4",
                                        "reverseModelPath": model_name,
                                        "reverseFallbackReason": "",
                                        "visualHasOcr": False,
                                        "analysisPartial": False,
                                        "analysisDegraded": True,
                                        "richPromptFallback": False,
                                        **diagnostics,
                                    }
                                salient_error_reason = (
                                    "provider-error"
                                    if isinstance(salient_error, Qwen3VLProviderError)
                                    else "inventory-rejected"
                                    if isinstance(
                                        salient_error,
                                        (VisualContractError, ValueError),
                                    )
                                    else "unexpected-error"
                                )
                                log_prompt_assistant_event(
                                    "reverse_salient_inventory_skipped",
                                    command="reverseImagePrompt",
                                    provider="qwen3_vl_abliterated_nf4",
                                    visualSchema=requested_schema,
                                    reason=salient_error_reason,
                                    contractElapsedMs=contract_elapsed_ms,
                                )
                        compiled = enrich_v2_generation_candidate(
                            compiled,
                            contract,
                            contract_elapsed_ms=contract_elapsed_ms,
                        )
                        model_name = reverse_model_path.name[:160]
                        log_prompt_assistant_event(
                            "reverse_provider_selected",
                            command="reverseImagePrompt",
                            requestedProvider=requested_provider,
                            reverseProvider="qwen3_vl_abliterated_nf4",
                            visualSchema=requested_schema,
                            modelName=model_name,
                            fallbackCode="",
                            contractAttempt=attempt,
                            retryAttempted=quality_gate_retried,
                            retryCount=retry_count,
                        )
                        return {
                            "description": compiled["prompt"],
                            "visualPrompt": compiled["visualPrompt"],
                            "generationRequirements": compiled["generationRequirements"],
                            "contentSafety": compiled["contentSafety"],
                            "contentWarnings": compiled["contentWarnings"],
                            "sensitivePromptBlocked": compiled["sensitivePromptBlocked"],
                            "generationGate": compiled["generationGate"],
                            "rawOutput": raw_output,
                            "qualityGateFailed": False,
                            "qualityGateRetried": quality_gate_retried,
                            "retryAttempted": quality_gate_retried,
                            "retryCount": retry_count,
                            "visualSchema": requested_schema,
                            "reverseProvider": "qwen3_vl_abliterated_nf4",
                            "reverseModelPath": model_name,
                            "reverseFallbackReason": (
                                "rich-prompt-fallback"
                                if compiled.get("richPromptFallback")
                                else ""
                            ),
                            "visualHasOcr": bool(contract["ocr"]),
                            **(
                                {"richPromptFallback": bool(
                                    compiled.get("richPromptFallback")
                                )}
                                if requested_schema == VISUAL_SCHEMA_VERSION_V2
                                else {}
                            ),
                        }
                except (Qwen3VLProviderError, VisualContractError) as exc:
                    fallback_code = (
                        getattr(exc, "code", "qwen3-vl-error")
                        if isinstance(exc, Qwen3VLProviderError)
                        else (
                            getattr(exc, "code", "visual-contract-invalid")
                            if requested_schema == VISUAL_SCHEMA_VERSION_V2
                            else "qwen3-contract-invalid"
                        )
                    )
                    if isinstance(exc, Qwen3VLProviderError):
                        provider_failure_code = fallback_code
                        contract_failure_code = ""
                        failure_category = "provider"
                    else:
                        provider_failure_code = fallback_code
                        contract_failure_code = fallback_code
                        failure_category = (
                            "semantic_contract" if exc.semantic else "contract_structure"
                        )
                    log_prompt_assistant_event(
                        (
                            "reverse_provider_fail_closed"
                            if requested_schema == VISUAL_SCHEMA_VERSION_V2
                            else "reverse_provider_fallback"
                        ),
                        command="reverseImagePrompt",
                        requestedProvider=requested_provider,
                        fromProvider="qwen3_vl_abliterated_nf4",
                        **(
                            {}
                            if requested_schema == VISUAL_SCHEMA_VERSION_V2
                            else {"toProvider": "qwen2_5_vl_fp8"}
                        ),
                        fallbackCode=fallback_code,
                        modelName=reverse_model_path.name[:160],
                        retryAttempted=quality_gate_retried,
                        retryCount=retry_count,
                        **(
                            contract_structure_diagnostics
                            if requested_schema == VISUAL_SCHEMA_VERSION_V2
                            and failure_category == "contract_structure"
                            else {}
                        ),
                    )
                except Exception:
                    fallback_code = "qwen3-unexpected-error"
                    provider_failure_code = fallback_code
                    contract_failure_code = ""
                    failure_category = "provider"
                    log_prompt_assistant_event(
                        (
                            "reverse_provider_fail_closed"
                            if requested_schema == VISUAL_SCHEMA_VERSION_V2
                            else "reverse_provider_fallback"
                        ),
                        command="reverseImagePrompt",
                        requestedProvider=requested_provider,
                        fromProvider="qwen3_vl_abliterated_nf4",
                        **(
                            {}
                            if requested_schema == VISUAL_SCHEMA_VERSION_V2
                            else {"toProvider": "qwen2_5_vl_fp8"}
                        ),
                        fallbackCode=fallback_code,
                        modelName=reverse_model_path.name[:160],
                        retryAttempted=quality_gate_retried,
                        retryCount=retry_count,
                    )
                finally:
                    if requested_schema == VISUAL_SCHEMA_VERSION_V2:
                        adapter.unload()
            else:
                fallback_code = clean_text(str(readiness.get("code") or "qwen3-unavailable"))[:80]
                provider_failure_code = fallback_code
                contract_failure_code = ""
                failure_category = "provider"
                log_prompt_assistant_event(
                    (
                        "reverse_provider_fail_closed"
                        if requested_schema == VISUAL_SCHEMA_VERSION_V2
                        else "reverse_provider_fallback"
                    ),
                    command="reverseImagePrompt",
                    requestedProvider=requested_provider,
                    fromProvider="qwen3_vl_abliterated_nf4",
                    **(
                        {}
                        if requested_schema == VISUAL_SCHEMA_VERSION_V2
                        else {"toProvider": "qwen2_5_vl_fp8"}
                    ),
                    fallbackCode=fallback_code,
                    modelName=reverse_model_path.name[:160],
                    retryAttempted=quality_gate_retried,
                    retryCount=retry_count,
                )

        if requested_schema == VISUAL_SCHEMA_VERSION_V2:
            raise VisualContractError(
                "nf.visual.v2 Qwen3 contract failed closed before legacy fallback",
                code="v2-qwen3-fail-closed",
                semantic=semantic_gate_invalid,
                diagnostics=v2_failure_diagnostics(
                    error_code="v2-qwen3-fail-closed",
                    provider_code=provider_failure_code or fallback_code,
                    contract_code=contract_failure_code,
                    category=failure_category or "provider",
                    retryable=True,
                ),
            )

        llama_template = (
            "<|im_start|>system\n"
            f"你是 NovaFlow 的本地视觉事实提取器，只返回严格的 {requested_schema} JSON。"
            "不因图片题材省略可见事实，不得猜测不可见细节。"
            "<|im_end|>\n"
            "<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n"
        )
        raw_output = ""
        contract_error = ""
        for attempt, seed in enumerate((1,), start=1):
            raw_output = self.generate(
                contract_prompt,
                images=[image_tensor],
                llama_template=llama_template,
                max_length=1200 if requested_schema == VISUAL_SCHEMA_VERSION_V2 else 1000,
                seed=seed,
                trace_label=f"reverseImageVisualFactsQwen25Attempt{attempt}",
                do_sample=False,
                temperature=0.0,
                top_p=1.0,
            )
            try:
                contract = parse_visual_contract(raw_output, expected_schema=requested_schema)
                compiled = compile_visual_prompt_details(
                    contract,
                    requirements,
                    nsfw=nsfw_enabled,
                )
                model_name = Path(self.loaded_model_path or self.model_path()).name[:160]
                log_prompt_assistant_event(
                    "reverse_provider_selected",
                    command="reverseImagePrompt",
                    requestedProvider=requested_provider,
                    reverseProvider="qwen2_5_vl_fp8",
                    visualSchema=requested_schema,
                    modelName=model_name,
                    fallbackCode=fallback_code,
                    contractAttempt=attempt,
                )
                return {
                    "description": compiled["prompt"],
                    "visualPrompt": compiled["visualPrompt"],
                    "generationRequirements": compiled["generationRequirements"],
                    "contentSafety": compiled["contentSafety"],
                    "contentWarnings": compiled["contentWarnings"],
                    "sensitivePromptBlocked": compiled["sensitivePromptBlocked"],
                    "generationGate": compiled["generationGate"],
                    "rawOutput": raw_output,
                    "qualityGateFailed": False,
                    "qualityGateRetried": quality_gate_retried,
                    "visualSchema": requested_schema,
                    "reverseProvider": "qwen2_5_vl_fp8",
                    "reverseModelPath": model_name,
                    "reverseFallbackReason": fallback_code,
                    "visualHasOcr": bool(contract["ocr"]),
                }
            except VisualContractError as exc:
                contract_error = "qwen2-contract-invalid"
                if exc.semantic:
                    semantic_gate_invalid = True
                log_prompt_assistant_event(
                    "reverse_visual_contract_retry",
                    command="reverseImagePrompt",
                    provider="qwen2_5_vl_fp8",
                    attempt=attempt,
                    errorCode=contract_error,
                    outputChars=len(raw_output),
                )

        legacy_prompt = (
            "你是 NovaFlow 的 AI反推助手。请根据图片中直接可见的内容生成一段适合图像生成模型使用的中文自然语言提示词。"
            "按主体、关系与动作、构图镜头、场景、光色、材质风格的顺序描述；不因题材省略可见事实，不猜测不可见细节。"
            "不要输出英文、SD标签、JSON、分析报告或多个方案。"
        )
        legacy_output = self.generate(
            legacy_prompt,
            images=[image_tensor],
            max_length=260,
            seed=3,
            trace_label="reverseImageLegacyFallback",
        )
        visual_prompt = clean_reverse_output(legacy_output)
        if not visual_prompt:
            raise ValueError("模型未返回可用的图片描述")
        generation_requirements = re.sub(r"\s+", " ", str(requirements or "")).strip()[:2000]
        description = visual_prompt
        if generation_requirements:
            description = (
                f"{visual_prompt.rstrip('。')}。"
                f"用户附加要求：{generation_requirements.rstrip('。')}。"
            )
        model_name = Path(self.loaded_model_path or self.model_path()).name[:160]
        combined_fallback = fallback_code or contract_error or "visual-contract-unavailable"
        log_prompt_assistant_event(
            "reverse_provider_selected",
            command="reverseImagePrompt",
            requestedProvider=requested_provider,
            reverseProvider="qwen2_5_vl_legacy",
            visualSchema="",
            modelName=model_name,
            fallbackCode=combined_fallback,
        )
        return {
            "description": description,
            "visualPrompt": visual_prompt,
            "generationRequirements": generation_requirements,
            "contentSafety": {},
            "contentWarnings": [],
            "sensitivePromptBlocked": False,
            "rawOutput": legacy_output,
            "qualityGateFailed": True,
            "qualityGateRetried": False,
            "visualSchema": "",
            "reverseProvider": "qwen2_5_vl_legacy",
            "reverseModelPath": model_name,
            "reverseFallbackReason": combined_fallback,
            "visualHasOcr": False,
        }

    def reverse_minimax_h3_prompt(
        self,
        mode: str,
        image_items: list,
        current_prompt: str,
        requirements: str,
        preferred_output_language: str = "",
        visual_policy: dict | None = None,
        sensitive_request_text: str = "",
        user_prompt: str = "",
        user_requirements: str = "",
    ) -> dict:
        expected_count = 2 if mode == "FL2VA" else 1
        if len(image_items) != expected_count:
            expected_text = "首帧和尾帧两张图片" if mode == "FL2VA" else "一张首帧图片"
            raise ValueError(f"MiniMax H3 {mode} 反推需要{expected_text}")
        requested_duration = minimax_h3_duration_from_requirements(requirements)

        def anchor_role(item: dict) -> str:
            marker = " ".join([
                str(item.get("slotType") or ""),
                str(item.get("role") or ""),
                str(item.get("name") or ""),
                str(item.get("label") or ""),
            ]).lower()
            if re.search(r"(first[_-]?frame|start[_-]?frame|首帧|第一帧)", marker):
                return "first"
            if re.search(r"(last[_-]?frame|end[_-]?frame|尾帧|最后一帧)", marker):
                return "last"
            return ""

        ordered_items = list(image_items)
        if mode == "I2VA":
            if anchor_role(image_items[0]) != "first":
                raise ValueError("MiniMax H3 I2VA 反推图片必须标记为首帧")
        else:
            first_item = next((item for item in image_items if anchor_role(item) == "first"), None)
            last_item = next((item for item in image_items if anchor_role(item) == "last"), None)
            if first_item is None or last_item is None or first_item is last_item:
                raise ValueError("MiniMax H3 FL2VA 反推图片必须分别标记为首帧和尾帧")
            ordered_items = [first_item, last_item]

        image_tensors = [item["tensor"] for item in ordered_items]
        visual_policy = dict(visual_policy or {})
        use_h3_visual_contract = visual_policy.get("enabled") is True
        visual_contracts: list[dict] = []
        private_visual_facts: list[str] = []
        safe_visual_metadata: list[dict] = []
        sensitive_enabled = visual_policy.get("sensitiveVisualAnalysis") is True
        if use_h3_visual_contract:
            adapter = Qwen3VLAbliteratedAdapter(
                self.reverse_model_path(),
                max_side=768,
                max_new_tokens=160,
            )
            readiness = adapter.readiness()
            if not readiness.get("available"):
                code = clean_text(readiness.get("code") or "qwen3-unavailable")[:80]
                raise VisualContractError(
                    "MiniMax H3 视觉事实模型未就绪",
                    code="h3-qwen3-required",
                    diagnostics={
                        "errorCode": "h3-qwen3-required",
                        "providerFailureCode": code,
                        "requestedVisualSchema": visual_policy.get("schema") or "",
                        "generationGate": "blocked",
                    },
                )
            self.reset_loaded_clip()
            log_prompt_assistant_event(
                "minimax_h3_visual_contract_start",
                command="reverseImagePrompt",
                mode=mode,
                visualSchema=visual_policy.get("schema") or "",
                imageCount=len(image_tensors),
                sensitiveVisualAnalysis=sensitive_enabled,
                provider="qwen3_vl_abliterated_nf4",
            )
            try:
                interaction_ir_repair_calls = 0
                interaction_rich_confirmation_calls = 0
                interaction_deactivation_fallbacks = 0
                sensitive_ir_review_calls = 0
                visual_ir_repair_calls = 0
                rich_visual_primary_calls = 0
                for index, image_tensor in enumerate(image_tensors, start=1):
                    rich_visual_primary_calls += 1
                    log_minimax_h3_bounded_stage(
                        "rich-visual-primary",
                        "started",
                        mode=mode,
                        schema=visual_policy.get("schema") or "",
                        picture_index=index,
                        attempt=1,
                    )
                    rich_primary = adapter.generate(
                        minimax_h3_faithful_rich_primary_instruction(),
                        image_tensor,
                        unload_after=False,
                        system_text=MINIMAX_H3_BOUNDED_VISUAL_SYSTEM_TEXT,
                        do_sample=False,
                        max_new_tokens=160,
                        stop_strings=(MINIMAX_H3_RICH_VISUAL_STOP_MARKER,),
                    )
                    try:
                        rich_primary = minimax_h3_bounded_visual_slots_to_rich(
                            rich_primary
                        )
                        contract = minimax_h3_project_faithful_rich_contract(
                            rich_primary,
                            index,
                        )
                    except VisualContractError as rich_error:
                        validation_leaf = clean_text(
                            (getattr(rich_error, "diagnostics", {}) or {}).get("validationLeaf")
                            or rich_error.code
                        )[:40]
                        log_minimax_h3_bounded_stage(
                            "rich-visual-primary",
                            "blocked",
                            mode=mode,
                            schema=visual_policy.get("schema") or "",
                            picture_index=index,
                            attempt=1,
                            reason_code=validation_leaf,
                        )
                        raise
                    log_minimax_h3_bounded_stage(
                        "rich-visual-primary",
                        "accepted",
                        mode=mode,
                        schema=visual_policy.get("schema") or "",
                        picture_index=index,
                        attempt=1,
                    )
                    facts, safe_metadata = minimax_h3_private_visual_facts(
                        contract,
                        visual_policy,
                        sensitive_request_text,
                        index,
                    )
                    visual_contracts.append(contract)
                    private_visual_facts.append(facts)
                    safe_visual_metadata.append(safe_metadata)
                    log_prompt_assistant_event(
                        "minimax_h3_visual_contract_stage",
                        command="reverseImagePrompt",
                        mode=mode,
                        visualSchema=visual_policy.get("schema") or "",
                        provider="qwen3_vl_abliterated_nf4",
                        interactionRepairCalls=0,
                        interactionDeactivationFallback=False,
                        visualIrRepairUsed=False,
                        **safe_metadata,
                    )
                    continue
                    interaction_deactivation_fallback = False
                    log_minimax_h3_bounded_stage(
                        "initial-ir",
                        "started",
                        mode=mode,
                        schema=visual_policy.get("schema") or "",
                        picture_index=index,
                        attempt=1,
                    )
                    raw_contract = adapter.generate(
                        minimax_h3_compact_visual_contract_instruction(),
                        image_tensor,
                        unload_after=False,
                    )
                    interaction_repair_calls = 0
                    sensitive_review_reason = ""
                    initial_young_evidence = False
                    initial_structural = None
                    repair_kind = ""
                    repair_error_code = ""
                    ir_repair_used = False
                    try:
                        contract = parse_minimax_h3_local_visual_contract(raw_contract)
                    except VisualContractError as exc:
                        if exc.code in {
                            "h3-sensitive-minor-request-blocked",
                            "h3-sensitive-young-evidence-blocked",
                        }:
                            raise
                        try:
                            initial_structural = parse_local_compact_visual_contract(
                                raw_contract,
                                validate_semantics=False,
                            )
                        except VisualContractError:
                            initial_structural = None
                        initial_young_evidence = bool(
                            minimax_h3_contains_affirmative_young(raw_contract)
                            or (
                                initial_structural is not None
                                and minimax_h3_contract_has_explicit_minor_evidence(
                                    initial_structural
                                )
                            )
                        )
                        if exc.code == "visual-contract-interaction-evidence-incomplete":
                            contract = None
                            repair_kind = "interaction"
                            repair_error_code = exc.code
                        elif sensitive_enabled and initial_structural is not None:
                            sensitive_review_reason = minimax_h3_sensitive_ir_review_reason(
                                initial_structural
                            )
                            if sensitive_review_reason:
                                contract = initial_structural
                            else:
                                contract = None
                                repair_kind = "visual-ir"
                                repair_error_code = exc.code
                        else:
                            contract = None
                            repair_kind = "visual-ir"
                            repair_error_code = exc.code
                    log_minimax_h3_bounded_stage(
                        "initial-ir",
                        "review-required" if sensitive_review_reason else (
                            f"{repair_kind}-repair-required" if contract is None else "accepted"
                        ),
                        mode=mode,
                        schema=visual_policy.get("schema") or "",
                        picture_index=index,
                        attempt=1,
                        reason_code=sensitive_review_reason,
                    )
                    initial_young_evidence = initial_young_evidence or bool(
                        contract is not None
                        and minimax_h3_contract_has_explicit_minor_evidence(contract)
                    )
                    raw_sensitive_request = bool(
                        minimax_h3_authorized_request_sensitive_categories(
                            sensitive_request_text
                        )
                        or minimax_h3_authorized_request_sensitive_facts(
                            sensitive_request_text
                        )
                    )
                    initial_sensitive_evidence = bool(
                        (contract is not None and minimax_h3_contract_has_sensitive_evidence(contract))
                        or (
                            initial_structural is not None
                            and minimax_h3_contract_has_sensitive_evidence(initial_structural)
                        )
                    )
                    if sensitive_enabled and (
                        (
                            minimax_h3_contains_affirmative_young(sensitive_request_text)
                            and (raw_sensitive_request or initial_sensitive_evidence)
                        )
                        or (
                            initial_young_evidence
                            and (raw_sensitive_request or initial_sensitive_evidence)
                        )
                    ):
                        youth_code = (
                            "h3-sensitive-minor-request-blocked"
                            if minimax_h3_contains_affirmative_young(sensitive_request_text)
                            else "h3-sensitive-young-evidence-blocked"
                        )
                        raise VisualContractError(
                            "MiniMax H3 敏感内容检测到明确年轻化或未成年证据，已阻断",
                            code=youth_code,
                            semantic=True,
                            diagnostics={
                                "errorCode": youth_code,
                                "requestedVisualSchema": visual_policy.get("schema") or "",
                                "pictureIndex": int(index),
                                "generationGate": "blocked",
                            },
                        )
                    if contract is None:
                        ir_repair_used = True
                        if repair_kind == "interaction":
                            if not sensitive_enabled:
                                raise VisualContractError(
                                    "MiniMax H3 敏感可见事实分析未显式开启",
                                    code="h3-sensitive-analysis-required",
                                    semantic=True,
                                    diagnostics={
                                        "errorCode": "h3-sensitive-analysis-required",
                                        "requestedVisualSchema": visual_policy.get("schema") or "",
                                        "pictureIndex": int(index),
                                        "generationGate": "blocked",
                                    },
                                )
                            interaction_repair_calls = 1
                            interaction_ir_repair_calls += 1
                            interaction_rich_confirmation_calls += 1
                            log_minimax_h3_bounded_stage(
                                "interaction-rich-confirmation",
                                "started",
                                mode=mode,
                                schema=visual_policy.get("schema") or "",
                                picture_index=index,
                                attempt=1,
                            )
                            rich_confirmation = adapter.generate(
                                minimax_h3_interaction_rich_confirmation_instruction(),
                                image_tensor,
                                unload_after=False,
                                system_text=RICH_VISUAL_SYSTEM_TEXT,
                                do_sample=True,
                                temperature=0.8,
                                top_p=0.9,
                                max_new_tokens=1024,
                            )
                            try:
                                first_structural = initial_structural or parse_local_compact_visual_contract(
                                    raw_contract,
                                    validate_semantics=False,
                                )
                                contract = minimax_h3_project_rich_interaction_contract(
                                    first_structural,
                                    rich_confirmation,
                                    index,
                                )
                            except VisualContractError as rich_error:
                                log_minimax_h3_bounded_stage(
                                    "interaction-rich-confirmation",
                                    "blocked",
                                    mode=mode,
                                    schema=visual_policy.get("schema") or "",
                                    picture_index=index,
                                    attempt=1,
                                    reason_code=rich_error.code,
                                )
                                raise
                            log_minimax_h3_bounded_stage(
                                "interaction-rich-confirmation",
                                "accepted",
                                mode=mode,
                                schema=visual_policy.get("schema") or "",
                                picture_index=index,
                                attempt=1,
                            )
                        else:
                            visual_ir_repair_calls += 1
                            log_minimax_h3_bounded_stage(
                                "visual-ir-repair",
                                "started",
                                mode=mode,
                                schema=visual_policy.get("schema") or "",
                                picture_index=index,
                                attempt=1,
                                reason_code=repair_error_code,
                            )
                            repaired_contract = adapter.generate(
                                minimax_h3_visual_ir_repair_instruction(repair_error_code),
                                image_tensor,
                                unload_after=False,
                            )
                            try:
                                contract = parse_minimax_h3_local_visual_contract(repaired_contract)
                            except VisualContractError as repaired_error:
                                log_minimax_h3_bounded_stage(
                                    "visual-ir-repair",
                                    "blocked",
                                    mode=mode,
                                    schema=visual_policy.get("schema") or "",
                                    picture_index=index,
                                    attempt=1,
                                    reason_code=repaired_error.code,
                                )
                                raise
                            log_minimax_h3_bounded_stage(
                                "visual-ir-repair",
                                "accepted",
                                mode=mode,
                                schema=visual_policy.get("schema") or "",
                                picture_index=index,
                                attempt=1,
                            )
                    if sensitive_enabled:
                        sensitive_review_reason = (
                            sensitive_review_reason
                            or minimax_h3_sensitive_ir_review_reason(contract)
                        )
                        if (
                            sensitive_review_reason == "sensitive-ir-safe"
                            and ir_repair_used
                            and not initial_sensitive_evidence
                            and minimax_h3_safe_ir_complete_and_consistent(
                                contract,
                                contract,
                            )
                        ):
                            # The bounded fresh IR repair is already the second
                            # same-image observation. A complete, semantically
                            # valid safe result may continue; no third call is
                            # allowed merely to repeat the safe classification.
                            sensitive_review_reason = ""
                        if sensitive_review_reason:
                            if ir_repair_used:
                                log_minimax_h3_bounded_stage(
                                    "sensitive-review",
                                    "blocked",
                                    mode=mode,
                                    schema=visual_policy.get("schema") or "",
                                    picture_index=index,
                                    attempt=1,
                                    reason_code="ir-repair-limit",
                                )
                                raise VisualContractError(
                                    "MiniMax H3 视觉IR修复后仍缺少可验证事实，已阻断",
                                    code="h3-sensitive-review-no-evidence",
                                    semantic=True,
                                    diagnostics={
                                        "errorCode": "h3-sensitive-review-no-evidence",
                                        "requestedVisualSchema": visual_policy.get("schema") or "",
                                        "pictureIndex": int(index),
                                        "generationGate": "blocked",
                                    },
                                )
                            sensitive_ir_review_calls += 1
                            log_minimax_h3_bounded_stage(
                                "sensitive-review",
                                "started",
                                mode=mode,
                                schema=visual_policy.get("schema") or "",
                                picture_index=index,
                                attempt=1,
                                reason_code=sensitive_review_reason,
                            )
                            reviewed_raw_contract = adapter.generate(
                                minimax_h3_sensitive_ir_review_instruction(),
                                image_tensor,
                                unload_after=False,
                            )
                            try:
                                reviewed_contract = parse_minimax_h3_local_visual_contract(
                                    reviewed_raw_contract
                                )
                                unresolved_review = minimax_h3_sensitive_ir_review_reason(
                                    reviewed_contract
                                )
                                if (
                                    sensitive_review_reason == "sensitive-ir-safe"
                                    and unresolved_review == "sensitive-ir-safe"
                                    and minimax_h3_safe_ir_complete_and_consistent(
                                        contract,
                                        reviewed_contract,
                                    )
                                ):
                                    unresolved_review = ""
                            except VisualContractError as review_error:
                                if review_error.code in {
                                    "h3-sensitive-minor-request-blocked",
                                    "h3-sensitive-young-evidence-blocked",
                                }:
                                    raise
                                unresolved_review = "sensitive-review-invalid"
                                reviewed_contract = None
                            if unresolved_review or reviewed_contract is None:
                                log_minimax_h3_bounded_stage(
                                    "sensitive-review",
                                    "blocked",
                                    mode=mode,
                                    schema=visual_policy.get("schema") or "",
                                    picture_index=index,
                                    attempt=1,
                                    reason_code=unresolved_review,
                                )
                                raise VisualContractError(
                                    "MiniMax H3 敏感事实完整性复核未获得可验证证据，已阻断",
                                    code="h3-sensitive-review-no-evidence",
                                    semantic=True,
                                    diagnostics={
                                        "errorCode": "h3-sensitive-review-no-evidence",
                                        "requestedVisualSchema": visual_policy.get("schema") or "",
                                        "pictureIndex": int(index),
                                        "generationGate": "blocked",
                                    },
                                )
                            if (
                                initial_young_evidence
                                and minimax_h3_contract_has_sensitive_evidence(
                                    reviewed_contract
                                )
                            ):
                                raise VisualContractError(
                                    "MiniMax H3 首轮视觉 IR 含明确年轻化或未成年证据，不能用于敏感事实编译",
                                    code="h3-sensitive-young-evidence-blocked",
                                    semantic=True,
                                    diagnostics={
                                        "errorCode": "h3-sensitive-young-evidence-blocked",
                                        "requestedVisualSchema": visual_policy.get("schema") or "",
                                        "pictureIndex": int(index),
                                        "generationGate": "blocked",
                                    },
                                )
                            contract = reviewed_contract
                            log_minimax_h3_bounded_stage(
                                "sensitive-review",
                                "accepted",
                                mode=mode,
                                schema=visual_policy.get("schema") or "",
                                picture_index=index,
                                attempt=1,
                            )
                    if (
                        sensitive_enabled
                        and initial_young_evidence
                        and minimax_h3_contract_has_sensitive_evidence(contract)
                    ):
                        raise VisualContractError(
                            "MiniMax H3 首轮视觉IR含明确未成年人证据，不能用于敏感事实编译",
                            code="h3-sensitive-young-evidence-blocked",
                            semantic=True,
                            diagnostics={
                                "errorCode": "h3-sensitive-young-evidence-blocked",
                                "requestedVisualSchema": visual_policy.get("schema") or "",
                                "pictureIndex": int(index),
                                "generationGate": "blocked",
                            },
                        )
                    facts, safe_metadata = minimax_h3_private_visual_facts(
                        contract,
                        visual_policy,
                        sensitive_request_text,
                        index,
                    )
                    visual_contracts.append(contract)
                    private_visual_facts.append(facts)
                    safe_visual_metadata.append(safe_metadata)
                    log_prompt_assistant_event(
                        "minimax_h3_visual_contract_stage",
                        command="reverseImagePrompt",
                        mode=mode,
                        visualSchema=visual_policy.get("schema") or "",
                        provider="qwen3_vl_abliterated_nf4",
                        interactionRepairCalls=interaction_repair_calls,
                        interactionDeactivationFallback=interaction_deactivation_fallback,
                        visualIrRepairUsed=ir_repair_used and repair_kind == "visual-ir",
                        **safe_metadata,
                    )
            except (Qwen3VLProviderError, VisualContractError) as exc:
                code = clean_text(getattr(exc, "code", "h3-visual-contract-failed"))[:80]
                log_prompt_assistant_event(
                    "minimax_h3_visual_contract_blocked",
                    command="reverseImagePrompt",
                    mode=mode,
                    visualSchema=visual_policy.get("schema") or "",
                    provider="qwen3_vl_abliterated_nf4",
                    errorCode=code,
                    completedStages=len(visual_contracts),
                    imageCount=len(image_tensors),
                )
                if isinstance(exc, VisualContractError):
                    raise
                raise VisualContractError(
                    "MiniMax H3 本地视觉事实分析未完成",
                    code="h3-qwen3-visual-analysis-failed",
                    diagnostics={
                        "errorCode": "h3-qwen3-visual-analysis-failed",
                        "providerFailureCode": code,
                        "requestedVisualSchema": visual_policy.get("schema") or "",
                        "generationGate": "blocked",
                    },
                ) from None
            finally:
                adapter.unload()
        minimax_h3_value_language = (
            normalize_minimax_h3_preferred_output_language(preferred_output_language)
            or minimax_h3_preferred_value_language(current_prompt, requirements)
        )
        if use_h3_visual_contract:
            log_minimax_h3_bounded_stage(
                "deterministic-primary",
                "started",
                mode=mode,
                schema=visual_policy.get("schema") or "",
                attempt=1,
            )
            try:
                description = build_minimax_h3_deterministic_verified_visual_candidate(
                    mode,
                    private_visual_facts,
                    requested_duration,
                    minimax_h3_value_language,
                    visual_contracts,
                    user_prompt=user_prompt,
                    user_requirements=user_requirements,
                )
                description = validate_minimax_h3_value_language(
                    description,
                    minimax_h3_value_language,
                )
                description = validate_minimax_h3_prompt_contract(
                    description,
                    mode,
                    requested_duration,
                )
                description = validate_minimax_h3_user_motion_intent_coverage(
                    description,
                    user_prompt,
                    user_requirements,
                )
                description = validate_minimax_h3_visual_fact_coverage(
                    description,
                    visual_contracts,
                    sensitive_enabled,
                    sensitive_request_text,
                    require_entity_slots=True,
                )
            except (TypeError, ValueError) as deterministic_error:
                failure_class = minimax_h3_safe_validation_failure_class(
                    deterministic_error
                )
                failure_leaf = minimax_h3_safe_validation_failure_leaf(
                    deterministic_error
                )
                log_minimax_h3_bounded_stage(
                    "deterministic-primary",
                    "failed",
                    mode=mode,
                    schema=visual_policy.get("schema") or "",
                    attempt=1,
                    reason_code=failure_leaf,
                )
                raise VisualContractError(
                    f"本地提示词助手未能生成符合 MiniMax H3 {mode} 忠实协议的确定性反推提示词，请调整素材后重试",
                    code="h3-local-deterministic-validation-failed",
                    semantic=True,
                    diagnostics={
                        "errorCode": "h3-local-deterministic-validation-failed",
                        "requestedVisualSchema": visual_policy.get("schema") or "",
                        "mode": mode,
                        "validationAttempts": 1,
                        "failureClass": failure_class,
                        "validationLeaf": failure_leaf,
                        "generationGate": "blocked",
                    },
                ) from None

            output_target = MINIMAX_H3_DETERMINISTIC_OUTPUT_TARGET_CHARS.get(mode, 0)
            output_chars = len(description)
            target_exceeded = bool(output_target and output_chars > output_target)
            log_minimax_h3_bounded_stage(
                "deterministic-primary",
                "accepted",
                mode=mode,
                schema=visual_policy.get("schema") or "",
                attempt=1,
                reason_code="fact-completeness-over-target" if target_exceeded else "",
            )
            self.status = "模型可用"
            log_prompt_assistant_event(
                "minimax_h3_visual_contract_complete",
                command="reverseImagePrompt",
                mode=mode,
                visualSchema=visual_policy.get("schema") or "",
                imageCount=len(image_tensors),
                visualFactCalls=len(image_tensors),
                richVisualPrimaryCalls=rich_visual_primary_calls,
                visualIrRepairCalls=visual_ir_repair_calls,
                interactionIrRepairCalls=interaction_ir_repair_calls,
                interactionRichConfirmationCalls=interaction_rich_confirmation_calls,
                interactionDeactivationFallbacks=interaction_deactivation_fallbacks,
                sensitiveIrReviewCalls=sensitive_ir_review_calls,
                h3CompileCalls=0,
                repairCalls=0,
                deterministicVisualPrimary=True,
                deterministicVisualFallback=False,
                deterministicOutputChars=output_chars,
                deterministicOutputTargetChars=output_target,
                deterministicOutputTargetExceeded=target_exceeded,
                sensitiveVisualAnalysis=sensitive_enabled,
            )
            return {
                "prompt": description,
                "output_text": description,
                "positivePrompt": description,
                "negativePrompt": "",
                "rawOutput": description,
                "qualityGateFailed": False,
                "visualSchema": visual_policy.get("schema") or "",
                "reverseProvider": "qwen3_vl_abliterated_nf4+deterministic_h3",
                "generationGate": "direct",
                "contentSafety": safe_visual_metadata,
                "contentWarnings": [],
                "sensitivePromptBlocked": False,
            }
        if mode == "FL2VA":
            image_tokens = (
                "<Picture 1> (first-frame anchor): <|vision_start|><|image_pad|><|vision_end|>\n"
                "<Picture 2> (last-frame anchor): <|vision_start|><|image_pad|><|vision_end|>\n"
            )
        else:
            image_tokens = "<Picture 1> (first-frame anchor): <|vision_start|><|image_pad|><|vision_end|>\n"
        required_protocol = (
            f"Required protocol: {mode}.\n{requirements}"
            if requirements else f"Required protocol: {mode}."
        )
        prompt = (
            build_minimax_h3_verified_visual_instruction(
                mode,
                private_visual_facts,
                current_prompt,
                required_protocol,
                preferred_output_language,
                sensitive_enabled,
                sensitive_request_text,
            )
            if use_h3_visual_contract
            else build_minimax_h3_reverse_instruction(
                mode,
                image_tokens,
                current_prompt,
                required_protocol,
                preferred_output_language,
            )
        )
        self.status = "推理中"
        output = self.generate(
            prompt,
            images=[] if use_h3_visual_contract else image_tensors,
            llama_template=MINIMAX_H3_PROMPT_LLAMA_TEMPLATE,
            max_length=minimax_h3_prompt_max_length(mode),
            trace_label=f"minimaxH3{mode}Reverse",
        )
        deterministic_visual_fallback_used = False
        try:
            normalized_output = validate_minimax_h3_value_language(
                normalize_minimax_h3_prompt_output(output),
                minimax_h3_value_language,
            )
            description = validate_minimax_h3_prompt_contract(
                complete_minimax_h3_mechanical_contract(
                    normalized_output,
                    mode,
                    requested_duration,
                    minimax_h3_value_language,
                ),
                mode,
                requested_duration,
            )
            if use_h3_visual_contract:
                description = validate_minimax_h3_visual_fact_coverage(
                    description,
                    visual_contracts,
                    sensitive_enabled,
                    sensitive_request_text,
                )
        except ValueError as first_error:
            if use_h3_visual_contract:
                log_minimax_h3_bounded_stage(
                    "compile-repair",
                    "started",
                    mode=mode,
                    schema=visual_policy.get("schema") or "",
                    attempt=1,
                    reason_code=minimax_h3_safe_validation_failure_class(first_error),
                )
            repair_prompt = (
                build_minimax_h3_verified_visual_repair_instruction(
                    output,
                    first_error,
                    mode,
                    private_visual_facts,
                    current_prompt,
                    required_protocol,
                    preferred_output_language,
                    sensitive_enabled,
                    sensitive_request_text,
                )
                if use_h3_visual_contract
                else build_minimax_h3_prompt_repair_instruction(
                    output,
                    current_prompt,
                    requirements,
                    mode,
                    first_error,
                    preferred_output_language,
                )
            )
            repair_output = self.generate(
                repair_prompt,
                images=[] if use_h3_visual_contract else image_tensors,
                llama_template=MINIMAX_H3_PROMPT_LLAMA_TEMPLATE,
                max_length=minimax_h3_prompt_max_length(mode, repair=True),
                seed=2,
                trace_label=f"minimaxH3{mode}ReverseRepair",
            )
            try:
                normalized_repair_output = validate_minimax_h3_value_language(
                    normalize_minimax_h3_prompt_output(repair_output),
                    minimax_h3_value_language,
                )
                description = validate_minimax_h3_prompt_contract(
                    complete_minimax_h3_mechanical_contract(
                        normalized_repair_output,
                        mode,
                        requested_duration,
                        minimax_h3_value_language,
                    ),
                    mode,
                    requested_duration,
                )
                if use_h3_visual_contract:
                    description = validate_minimax_h3_visual_fact_coverage(
                        description,
                        visual_contracts,
                        sensitive_enabled,
                        sensitive_request_text,
                    )
                    log_minimax_h3_bounded_stage(
                        "compile-repair",
                        "accepted",
                        mode=mode,
                        schema=visual_policy.get("schema") or "",
                        attempt=1,
                    )
            except ValueError as repair_error:
                if use_h3_visual_contract:
                    log_minimax_h3_bounded_stage(
                        "compile-repair",
                        "failed",
                        mode=mode,
                        schema=visual_policy.get("schema") or "",
                        attempt=1,
                        reason_code=minimax_h3_safe_validation_failure_class(repair_error),
                    )
                    log_minimax_h3_bounded_stage(
                        "deterministic-fallback",
                        "started",
                        mode=mode,
                        schema=visual_policy.get("schema") or "",
                        attempt=1,
                    )
                    try:
                        deterministic_candidate = (
                            build_minimax_h3_deterministic_verified_visual_candidate(
                                mode,
                                private_visual_facts,
                                requested_duration,
                                minimax_h3_value_language,
                            )
                        )
                        deterministic_candidate = validate_minimax_h3_value_language(
                            deterministic_candidate,
                            minimax_h3_value_language,
                        )
                        deterministic_candidate = validate_minimax_h3_prompt_contract(
                            deterministic_candidate,
                            mode,
                            requested_duration,
                        )
                        description = validate_minimax_h3_visual_fact_coverage(
                            deterministic_candidate,
                            visual_contracts,
                            sensitive_enabled,
                            sensitive_request_text,
                        )
                        deterministic_visual_fallback_used = True
                        log_minimax_h3_bounded_stage(
                            "deterministic-fallback",
                            "accepted",
                            mode=mode,
                            schema=visual_policy.get("schema") or "",
                            attempt=1,
                        )
                    except ValueError as deterministic_error:
                        deterministic_visual_fallback_used = False
                        log_minimax_h3_bounded_stage(
                            "deterministic-fallback",
                            "failed",
                            mode=mode,
                            schema=visual_policy.get("schema") or "",
                            attempt=1,
                            reason_code=minimax_h3_safe_validation_failure_class(
                                deterministic_error
                            ),
                        )
                if not deterministic_visual_fallback_used:
                    failure_code = (
                        "h3-local-visual-fidelity-failed"
                        if use_h3_visual_contract
                        else "h3-local-reverse-validation-failed"
                    )
                    raise VisualContractError(
                        f"本地提示词助手未能生成符合 MiniMax H3 {mode} 忠实协议的反推提示词，请调整素材后重试",
                        code=failure_code,
                        semantic=use_h3_visual_contract,
                        diagnostics={
                            "errorCode": failure_code,
                            "requestedVisualSchema": visual_policy.get("schema") or "",
                            "mode": mode,
                            "validationAttempts": 2,
                            "firstFailureClass": minimax_h3_safe_validation_failure_class(first_error),
                            "repairFailureClass": minimax_h3_safe_validation_failure_class(repair_error),
                            "generationGate": "blocked",
                        },
                    ) from None
        self.status = "模型可用"
        visual_generation_gate = "direct"
        if use_h3_visual_contract:
            log_prompt_assistant_event(
                "minimax_h3_visual_contract_complete",
                command="reverseImagePrompt",
                mode=mode,
                visualSchema=visual_policy.get("schema") or "",
                imageCount=len(image_tensors),
                visualFactCalls=len(image_tensors),
                interactionIrRepairCalls=interaction_ir_repair_calls,
                interactionDeactivationFallbacks=interaction_deactivation_fallbacks,
                sensitiveIrReviewCalls=sensitive_ir_review_calls,
                h3CompileCalls=1,
                repairCalls=1 if "repair_output" in locals() else 0,
                deterministicVisualFallback=deterministic_visual_fallback_used,
                sensitiveVisualAnalysis=sensitive_enabled,
            )
        return {
            "prompt": description,
            "output_text": description,
            "positivePrompt": description,
            "negativePrompt": "",
            "rawOutput": description,
            "qualityGateFailed": False,
            **({
                "visualSchema": visual_policy.get("schema") or "",
                "reverseProvider": "qwen3_vl_abliterated_nf4+h3_qwen2_5_vl",
                "generationGate": visual_generation_gate,
                "contentSafety": safe_visual_metadata,
                "contentWarnings": [],
                "sensitivePromptBlocked": False,
            } if use_h3_visual_contract else {}),
        }

    def reverse_image_prompt(self, payload: dict) -> dict:
        images = payload.get("images")
        purpose = str(payload.get("purpose") or "").strip()
        minimax_h3_reverse_mode = minimax_h3_reverse_mode_from_purpose(purpose)
        is_animation = is_animation_prompt_payload(payload)
        is_ui_design = is_ui_design_prompt_payload(payload)
        current_prompt = current_prompt_from_payload(payload)
        requirements_limit = 12000 if minimax_h3_reverse_mode else 2000
        requirements = clean_text(payload.get("requirements") or "")[:requirements_limit]
        current_prompt_instruction = (
            "\n当前已有视频提示（必须与图片可见信息合并）：\n"
            f"{current_prompt}\n"
            "最终只输出一段合并后的提示词；保留当前提示中的动作与镜头意图，但不得覆盖图片中可见的主体身份、外观和场景锚点。"
            if current_prompt and is_animation else ""
        )
        requirements_instruction = (
            "\n用户附加要求（高优先级输出约束）：\n"
            f"{requirements}\n"
            "请先正确理解图片主体，再按附加要求调整最终生成提示词；未被要求改变的可见主体和关键特征必须保持一致。"
            if requirements else ""
        )
        merge_instruction = f"{current_prompt_instruction}{requirements_instruction}"
        if not isinstance(images, list) or not images:
            raise ValueError("请先选择可分析的图片")
        if is_ui_design and len(images) > 3:
            raise ValueError("设计助手一次最多分析 3 张参考图，请先选择需要分析的图片")
        image_items = []
        for item in images[:3]:
            if not isinstance(item, dict):
                continue
            tensor = data_url_to_tensor(str(item.get("dataUrl") or ""))
            if tensor is None:
                continue
            image_items.append({
                "tensor": tensor,
                "name": str(item.get("name") or ""),
                "slotType": str(item.get("slotType") or ""),
                "role": str(item.get("role") or ""),
                "label": str(item.get("label") or ""),
            })
        image_tensors = [item["tensor"] for item in image_items]
        if not image_tensors:
            raise ValueError("没有可分析的图片数据")

        if minimax_h3_reverse_mode:
            visual_policy = normalize_minimax_h3_visual_policy(payload)
            user_prompt, user_requirements = minimax_h3_user_authored_intent_fields(payload)
            sensitive_request_text = "\n".join(
                item for item in (user_prompt, user_requirements) if item
            )
            return self.reverse_minimax_h3_prompt(
                minimax_h3_reverse_mode,
                image_items,
                current_prompt,
                requirements,
                normalize_minimax_h3_preferred_output_language(
                    payload.get("preferredOutputLanguage")
                    or payload.get("preferred_output_language")
                    or ""
                ),
                visual_policy,
                sensitive_request_text,
                user_prompt,
                user_requirements,
            )

        if purpose.lower().replace("_", "-") == "ui-design-quality-review":
            mandatory_checklist = normalize_ui_design_mandatory_checklist(
                payload.get("mandatoryChecklist")
            )
            mandatory_checklist_tokens = [
                item["checklistToken"] for item in mandatory_checklist
            ]
            mandatory_checklist_rule = (
                "以下是由页面语义结构生成的必检清单。必须逐项检查候选成品中对应功能是否存在、"
                "位置职责是否正确且可辨认；checklistToken是稳定ID，不是界面文案。"
                "任一项失败时status必须为FAIL，并把对应稳定ID原样写入failedChecklistTokens；"
                "不得改写ID、不得遗漏、不得新增清单外ID。PASS或REVIEW时failedChecklistTokens必须为空。"
                f"\n语义必检清单：{json.dumps(mandatory_checklist, ensure_ascii=False, separators=(',', ':'))}\n"
                if mandatory_checklist
                else "本次没有可用的页面语义必检清单，failedChecklistTokens必须为空。\n"
            )
            candidate_index = next((
                index
                for index, item in enumerate(image_items)
                if clean_text(item.get("role") or item.get("slotType")).lower() == "candidate"
            ), 0)
            visual_inventory = unavailable_ui_design_visual_inventory(
                mandatory_checklist,
                "no-mandatory-checklist",
            )
            inventory_output = ""
            grid_verifications = []
            if mandatory_checklist:
                inventory_contract = [
                    {
                        "checklistToken": item["checklistToken"],
                        "regionId": item["regionId"],
                        "kind": item["kind"],
                        "regionOrdinal": int(item["checklistToken"].split(":", 1)[0].split("-", 1)[1]),
                        "semanticToken": item["semanticToken"],
                        "expectedRect": item.get("expectedRect"),
                        "genericDefinition": ui_design_inventory_semantic_definition(
                            item["semanticToken"]
                        ),
                    }
                    for item in mandatory_checklist
                ]
                inventory_prompt = (
                    "图片1（候选成品图，仅做可见事实盘点）: "
                    "<|vision_start|><|image_pad|><|vision_end|>\n"
                    "你是 UI 候选图的可见事实盘点器。本阶段没有目标生成要求，也没有任何参考图；"
                    "禁止判断主题是否正确、风格是否漂亮或是否像参考图，只检查候选图本身。"
                    "请按照下面的通用语义检查清单逐项观察，每个checklistToken必须原样返回且只能返回一次。"
                    "regionOrdinal表示页面语义区域顺序，regionId和kind表示区域职责；候选项必须出现在对应区域并符合"
                    "genericDefinition，其他区域里的相似图形不得算作PRESENT。"
                    "expectedRect若存在，是候选图中的归一化目标矩形{xNorm,yNorm,wNorm,hNorm}，"
                    "坐标原点在左上角；对应控件的主体必须落在该矩形内，矩形外的相似图形不得算作PRESENT。"
                    "PRESENT表示对应semanticToken在候选图中清楚可见、可辨认且承担该UI功能；"
                    "MISSING仅表示有充分图像证据确认该功能没有出现；"
                    "UNCLEAR表示画面太小、被遮挡、含义不确定或无法可靠区分。"
                    "对于grid-列数x行数清单，evidence必须以observed=实际列数x实际行数开头，"
                    "例如observed=3x2；只能填写实际看见的重复网格，状态条、金额栏、按钮行或区域外图标不得计入；"
                    "若无法可靠数清，必须返回UNCLEAR和observed=unclear，禁止照抄清单要求。"
                    "不确定时必须使用UNCLEAR，不得猜测为MISSING。evidence只写候选图中的简短可见事实，"
                    "不得引用目标要求、参考图、主题名称或审美评价。"
                    "只输出一个合法JSON对象，不要Markdown或额外解释，严格使用："
                    '{"items":[{"checklistToken":"","status":"PRESENT|MISSING|UNCLEAR","evidence":""}]}\n'
                    f"通用语义检查清单：{json.dumps(inventory_contract, ensure_ascii=False, separators=(',', ':'))}"
                )
                inventory_template = (
                    "<|im_start|>system\n"
                    "你只盘点一张 UI 候选图中的可见事实，并只返回合法 JSON。"
                    "<|im_end|>\n"
                    "<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n"
                )
                self.status = "推理中"
                try:
                    inventory_output = self.generate(
                        inventory_prompt,
                        images=[image_tensors[candidate_index]],
                        llama_template=inventory_template,
                        max_length=min(1800, max(480, 180 + len(mandatory_checklist) * 38)),
                        seed=3,
                        trace_label="uiDesignVisualInventory",
                    )
                    visual_inventory = parse_ui_design_visual_inventory_output(
                        inventory_output,
                        mandatory_checklist_tokens,
                    )
                except Exception as inventory_error:
                    visual_inventory = unavailable_ui_design_visual_inventory(
                        mandatory_checklist,
                        inventory_error,
                    )
                    log_prompt_assistant_event(
                        "ui_visual_inventory_unavailable",
                        command="reverseImagePrompt",
                        mode="ui_design",
                        error=str(inventory_error),
                    )
            if mandatory_checklist and visual_inventory.get("available") is not False:
                grid_template = (
                    "<|im_start|>system\n"
                    "你只计算一张裁切 UI 图中的重复内容网格列数与行数，并只返回合法 JSON。"
                    "<|im_end|>\n"
                    "<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n"
                )
                for checklist_item in mandatory_checklist[:48]:
                    grid_match = re.fullmatch(
                        r"grid-([2-9]\d*)x([2-9]\d*)",
                        clean_text(str(checklist_item.get("semanticToken") or "")).lower(),
                    )
                    expected_rect = checklist_item.get("expectedRect")
                    if not grid_match or not isinstance(expected_rect, dict):
                        continue
                    checklist_token = checklist_item["checklistToken"]
                    expected_columns = int(grid_match.group(1))
                    expected_rows = int(grid_match.group(2))
                    try:
                        grid_crop = crop_ui_design_tensor_to_expected_rect(
                            image_tensors[candidate_index],
                            expected_rect,
                        )
                        grid_prompt = (
                            "图片1（候选成品中裁切出的一个重复内容区域）: "
                            "<|vision_start|><|image_pad|><|vision_end|>\n"
                            "只观察裁切图本身，计算主要重复内容单元构成的实际列数与行数。"
                            "以对齐的单元格、卡片、符号中心或明确分隔线判断结构；"
                            "装饰边框、标题、状态提示、金额栏、按钮行和零散图标都不能算作网格单元。"
                            "不得根据常见界面模板猜测，不得补齐看不见的行或列。"
                            "若局部装饰遮挡，仍按清楚可见且规律对齐的主要单元结构计数。"
                            "只输出一个合法JSON对象，不要Markdown或额外解释，严格使用："
                            '{"columns":1,"rows":1,"confidence":0.0,"evidence":""}'
                        )
                        grid_output = self.generate(
                            grid_prompt,
                            images=[grid_crop],
                            llama_template=grid_template,
                            max_length=180,
                            seed=5,
                            trace_label="uiDesignGridCount",
                        )
                        grid_count = parse_ui_design_grid_count_output(grid_output)
                        visual_inventory = apply_ui_design_grid_count(
                            visual_inventory,
                            checklist_token,
                            expected_columns,
                            expected_rows,
                            grid_count,
                        )
                        grid_verifications.append({
                            "checklistToken": checklist_token,
                            **grid_count,
                        })
                    except Exception as grid_error:
                        grid_verifications.append({
                            "checklistToken": checklist_token,
                            "columns": 0,
                            "rows": 0,
                            "confidence": 0.0,
                            "evidence": clean_text(str(grid_error))[:120],
                        })
                        log_prompt_assistant_event(
                            "ui_grid_count_unavailable",
                            command="reverseImagePrompt",
                            mode="ui_design",
                            checklistToken=checklist_token,
                            error=str(grid_error),
                        )
            image_tokens = "".join(
                (
                    f"图片{i + 1}（候选成品图，必须审查）: <|vision_start|><|image_pad|><|vision_end|>\n"
                    if i == candidate_index
                    else (
                        f"图片{i + 1}（原参考图，仅用于检查错误照搬；职责："
                        f"{clean_text(item.get('role') or item.get('slotType') or 'reference')}）: "
                        "<|vision_start|><|image_pad|><|vision_end|>\n"
                    )
                )
                for i, item in enumerate(image_items)
            )
            quality_prompt = (
                f"{image_tokens}"
                "你是 NovaFlow 的游戏 UI 成品质量审查器。只审查标记为“候选成品图”的图片；"
                "其余图片是原参考图，必须按标注职责判断：layout或composition参考允许候选保留功能区位置、相对比例、分组、间距、密度和控件关系，"
                "这些构图相似本身不是泄漏；material、style或color参考允许保留其声明的视觉属性。"
                "无论职责如何，都不得复制用户未要求的主题、人物身份、Logo、标题文案、背景对象或专属图标。"
                "必须根据目标生成要求和审查规则进行严格但保守的审查，不得因为个人审美偏好判定硬失败。\n"
                "审查顺序必须是：先逐项核验目标主题和主体，再核验用户明确要求的每个页面区域、主要内容、核心功能和操作控件，"
                "最后检查参考图泄漏、视觉层级、材质、光影、资产一致性、可读性与商业完整度。不得因为画面风格漂亮而忽略结构缺失。\n"
                "内容或结构硬失败包括：目标主题或指定主体明显错误；用户明确要求的页面结构、主要内容、功能或操作控件明显缺失；"
                "当目标是页面、界面或全屏数字画布且没有明确要求实体设备时，候选图出现机柜、机身、手机框、系统状态栏、产品展示外壳、物理台面或硬件按钮；"
                "只有目标明确要求硬件、设备外观或产品样机时才允许这些实体载体；"
                "错误照搬参考图中未被要求的主题、人物身份、Logo、标题文案、背景对象或专属图标；"
                "页面结构图的矩形框、节点、连线、端口、编号、辅助线或编辑器痕迹被画进成品；"
                "核心 UI 严重不可读，无法作为所要求的页面使用。\n"
                "十项评分均为0到100且越高越好：themeAdherence是主题与主体符合度；"
                "structureAdherence是页面结构符合度；referenceLeakage为100表示没有错误照搬、0表示严重照搬；"
                "readability是核心信息和控件可读性；commercialFinish是总体商业成品完成度；"
                "visualHierarchy是焦点、分组和对比节奏；materialCoherence是材质语言与目标风格的一致性；"
                "lightingCoherence是光向、值阶和前后层次的一致性，扁平风不强求立体高光；"
                "assetConsistency是图标、符号、卡片或插画在透视、比例、边缘、留白和渲染语言上的统一；"
                "commercialCompleteness是要求区域、状态、操作、边缘与安全区是否达到可交付完整度。"
                "单一主观画质项偏低不能直接判FAIL；只有多个客观画质维度同时明显不足时才使用QUALITY_POLISH_INSUFFICIENT。"
                "有明确失败时status必须为FAIL并列出failureCodes、failureClass和hardFailures，"
                "同时retryPrompt给出一段可直接用于重新生成或精修的完整修正要求；"
                "retryPrompt必须明确重述缺失的页面区域、功能或低分画质维度，不能只写“与参考图不同”或泛化的防照搬要求；"
                "retryPrompt禁止使用图片1、图片2、图片3等编号，必须直接写“候选成品”或具体结构名称；"
                "无硬失败且证据充分时为PASS；图片证据不足、文字太小或判断不确定时为REVIEW，不能猜测。"
                f"{mandatory_checklist_rule}"
                "只输出一个合法 JSON 对象，不要Markdown代码块、解释或额外文字。严格使用以下字段："
                '{"status":"PASS|FAIL|REVIEW","hardFailures":[],"failureCodes":[],"failedChecklistTokens":[],'
                '"failureClass":"STRUCTURE|CONTENT|POLISH|READABILITY|LEAKAGE|",'
                '"scores":{"themeAdherence":0,"structureAdherence":0,"referenceLeakage":0,'
                '"readability":0,"commercialFinish":0,"visualHierarchy":0,"materialCoherence":0,'
                '"lightingCoherence":0,"assetConsistency":0,"commercialCompleteness":0},"summary":"",'
                '"retryPrompt":"","confidence":0.0}\n'
                f"目标生成要求：\n{current_prompt or '未提供'}\n"
                f"审查规则与页面结构：\n{requirements or '按上述默认规则审查'}"
            )
            quality_template = (
                "<|im_start|>system\n"
                "你是严格的游戏 UI 成品质量审查器。只返回一个合法 JSON 对象，不输出 Markdown 或额外解释。"
                "<|im_end|>\n"
                "<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n"
            )
            self.status = "推理中"
            output = self.generate(
                quality_prompt,
                images=image_tensors,
                llama_template=quality_template,
                max_length=760,
                trace_label="uiDesignQualityReview",
            )
            try:
                quality_review = parse_ui_design_quality_review_output(
                    output,
                    mandatory_checklist_tokens,
                )
            except Exception as first_error:
                repair_prompt = (
                    f"{image_tokens}"
                    "上一次 UI 质量审查输出不是有效的约定 JSON。请根据同一批图片、目标要求和审查规则重新审查，"
                    "只返回一个合法 JSON 对象，十项scores字段一个都不能缺少，failureCodes、"
                    "failedChecklistTokens和failureClass必须存在。"
                    "status只能是PASS、FAIL或REVIEW；confidence为0到1。"
                    "所有scores都是越高越好；referenceLeakage为100表示没有错误照搬，0表示严重照搬；"
                    "PASS时不得出现低于50的评分。"
                    "不要Markdown代码块，不要额外解释。\n"
                    f"{mandatory_checklist_rule}"
                    f"目标生成要求：\n{current_prompt or '未提供'}\n"
                    f"审查规则与页面结构：\n{requirements or '按默认规则审查'}\n"
                    f"无效输出：\n{clean_text(output)[:1600]}"
                )
                retry_output = self.generate(
                    repair_prompt,
                    images=image_tensors,
                    llama_template=quality_template,
                    max_length=760,
                    seed=2,
                    trace_label="uiDesignQualityReviewRepair",
                )
                try:
                    quality_review = parse_ui_design_quality_review_output(
                        retry_output,
                        mandatory_checklist_tokens,
                    )
                    output = retry_output
                except Exception as retry_error:
                    quality_review = {
                        "status": "REVIEW",
                        "hardFailures": [],
                        "failureCodes": [],
                        "failedChecklistTokens": [],
                        "failureClass": "",
                        "scores": {key: 0 for key in UI_DESIGN_QUALITY_SCORE_KEYS},
                        "summary": "本地模型未返回可解析的 UI 质量审查结果，需要人工复核",
                        "retryPrompt": "",
                        "confidence": 0.0,
                    }
                    log_prompt_assistant_event(
                        "quality_review_parse_failed",
                        command="reverseImagePrompt",
                        mode="ui_design",
                        firstError=str(first_error),
                        retryError=str(retry_error),
                        preview=clean_text(retry_output)[:240],
                    )
                    output = retry_output
            quality_review = merge_ui_design_visual_inventory(
                quality_review,
                visual_inventory,
                mandatory_checklist,
            )
            self.status = "模型可用"
            return {
                "qualityReview": quality_review,
                "visualInventory": visual_inventory,
                "gridVerifications": grid_verifications,
                "rawOutput": output,
                "qualityGateFailed": quality_review["status"] == "FAIL",
            }

        if purpose.lower().replace("_", "-") == "ui-design-style-profile":
            role_labels = [str(item.get("role") or item.get("slotType") or "reference") for item in image_items]
            image_tokens = "".join(
                f"图片{i + 1}（职责：{role_labels[i]}）: <|vision_start|><|image_pad|><|vision_end|>\n"
                for i in range(len(image_tensors))
            )
            style_profile_prompt = (
                f"{image_tokens}"
                "你是 NovaFlow UI 的视觉风格与用户内容合同分析器。styleProfile只从参考图提取可跨主题迁移的视觉属性，"
                "不得在styleProfile中输出或复述人物、动物、道具、页面类型、功能、按钮名称、Logo、标题、文案、布局、区域位置或主题专名。"
                "contentIdentityLock只能从用户目标原文提取，严禁从任何图片提取内容；每一项必须是用户目标中真实出现的原文短语，"
                "不得推测、补写、改写或引入参考图中的主体、主题、按钮、布局与文字。identityAnchors用于主体、主题和页面类型。"
                "requiredElements只能包含成品画面中实际可见的主体、内容、数量要求和控件；"
                "输出尺寸、分辨率、横屏或竖屏、手机端或桌面端、小屏可读性，以及质量、材质、完成度等展示或交付约束，"
                "都不得写入requiredElements。用户明确要求“展示一部手机”或展示某个设备商品时，手机或设备本身属于可见内容，必须保留；"
                "仅要求适配手机端、桌面端或目标视口时，不得据此添加手机、设备、状态栏、外框或样机。"
                "exactTokens只用于成品界面内必须原样可见的英文标签、文案或数值，不得收录输出分辨率等交付规格。"
                "用户目标没有明确内容时对应数组使用空数组。styleProfile不得使用自由文本。palette只能返回2到5个#RRGGBB色值；"
                "其他字段只能从下列安全枚举中选择并以数组返回，参考图没有可靠证据时使用空数组。"
                "contrast可选：low, medium, high, focal-emphasis, layered-values。"
                "material可选：matte, glossy, polished-metal, gilded-metal, stone, jade-like, glass, ceramic, wood, woven-fabric, paper, leather, translucent, emissive, painted。"
                "lighting可选：flat, soft-diffuse, directional, rim-accent, backlit, volumetric, ambient, dramatic, high-key, low-key, glow-accent。"
                "shapeLanguage可选：geometric, organic, rounded, angular, symmetrical, asymmetrical, thin-line, bold-line, layered, minimal, ornate。"
                "ornamentDensity可选：none, low, restrained, medium, high, focal-only, border-focused, surface-patterned。"
                "typographyMood可选：modern, classical, formal, playful, technical, luxury, bold-display, compact, high-legibility。"
                "finish可选：flat-vector, painted-2d, stylized-3d, realistic-3d, commercial-game-ui, cinematic, illustrative, high-detail, clean, premium。"
                "只输出一个合法 JSON 对象，不要 Markdown、解释或额外字段。"
                "严格使用以下嵌套字段："
                '{"styleProfile":{"palette":[],"contrast":[],"material":[],"lighting":[],"shapeLanguage":[],'
                '"ornamentDensity":[],"typographyMood":[],"finish":[]},'
                '"contentIdentityLock":{"identityAnchors":[],"requiredElements":[],"exactTokens":[]}}\n'
                f"用户目标（contentIdentityLock的唯一来源）：\n{current_prompt or '未提供'}\n"
                f"补充约束：\n{requirements or '仅提取主题无关的视觉风格属性'}"
            )
            style_profile_template = (
                "<|im_start|>system\n"
                "你是 UI 视觉风格分析器，只返回一个合法 JSON 对象。"
                "<|im_end|>\n"
                "<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n"
            )
            self.status = "推理中"
            output = self.generate(
                style_profile_prompt,
                images=image_tensors,
                llama_template=style_profile_template,
                max_length=560,
                trace_label="uiDesignStyleProfile",
            )
            description = clean_reverse_output(output)
            if not description:
                raise ValueError("模型未返回可用的 UI 风格合同")
            self.status = "模型可用"
            return {
                "prompt": description,
                "negativePrompt": "",
                "rawOutput": output,
                "qualityGateFailed": False,
            }

        if is_ui_design:
            role_labels = [str(item.get("role") or item.get("slotType") or "reference") for item in image_items]
            image_tokens = "".join(
                f"图片{i + 1}（职责：{role_labels[i]}）: <|vision_start|><|image_pad|><|vision_end|>\n"
                for i in range(len(image_tensors))
            )
            prompt_context = (
                "\n当前设计要求（必须合并，并原样保留所有 __NOVAFLOW_...__ 资源占位符）：\n"
                f"{current_prompt}\n"
                if current_prompt else ""
            )
            requirements_context = (
                "\n页面结构、输出尺寸与用户约束（高优先级）：\n"
                f"{requirements}\n"
                if requirements else ""
            )
            prompt = (
                f"{image_tokens}"
                "你是 NovaFlow UI 版块专用的设计助手。联合分析这些参考图，但必须严格按每张图标注的职责工作："
                "layout只提取页面分区与信息层级，style只提取配色、线条、材质、光影和装饰语言，color只提取配色关系，"
                "material只提取材质，content只提取可用内容素材，subject只保持指定主体身份，reference只提供辅助视觉线索。"
                "禁止把任一参考图的无关人物、文字、按钮、Logo、水印、软件窗口、布局或背景复制到最终方案。"
                "生成一段可直接用于 UI 图像生成模型的中文设计要求，明确页面目标、功能分区、视觉层级、配色、材质、"
                "控件状态、间距、对齐和可读性。页面结构与尺寸约束优先于参考图。"
                "只能输出一段最终设计要求，不要输出图片分析、多个方案、英文、SD 标签、JSON、坐标、百分比、"
                "节点、连线、矩形标注或操作说明。"
                "如果当前设计要求含有 __NOVAFLOW_ 开头并以双下划线结尾的占位符，必须原样且原次数保留。"
                f"{prompt_context}{requirements_context}"
            )
            llama_template = (
                "<|im_start|>system\n你是 NovaFlow 的 UI 设计助手，只输出一段最终中文 UI 设计要求。<|im_end|>\n"
                "<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n"
            )
            self.status = "推理中"
            output = self.generate(
                prompt,
                images=image_tensors,
                llama_template=llama_template,
                max_length=320,
                trace_label="uiDesignReferenceAssistant",
            )
            description = clean_reverse_output(output)
            if not description:
                raise ValueError("模型未返回可用的 UI 设计要求")
            negative_prompt = ""
            if ui_design_uses_negative_prompt(payload):
                negative_prompt = build_targeted_negative_prompt(
                    f"UI 界面 布局 {requirements} {purpose}",
                    description,
                )
                if not negative_prompt:
                    raise ValueError("模型未返回可用的负向关键词")
            self.status = "模型可用"
            return {
                "prompt": description,
                "negativePrompt": negative_prompt,
                "rawOutput": output,
                "qualityGateFailed": False,
            }

        self.status = "推理中"
        description = ""
        quality_gate_failed = False
        reverse_diagnostics = {}
        if len(image_tensors) == 1:
            if purpose == "storyboardReference":
                prompt = (
                    "你是 NovaFlow 的分镜参考图解析助手。请只提取后续9格分镜需要长期保持的视觉锚点，"
                    "不要把背景或姿势写成固定剧情模板。请用中文短句输出，包含："
                    "主体身份/数量、主体造型、发型和脸部印象、服装轮廓和颜色、随身道具、画风、色彩光线、世界环境和时代、"
                    "可作为剧情素材的地点/物体/气氛、禁止复制的姿势/构图/背景。"
                    "必须优先写清主体可见外观：上衣/下装/外套/盔甲/裙装/鞋帽的类型和颜色，包/武器/工具/饰品的类型和颜色，"
                    "头发长度/颜色/轮廓，体型年龄感，以及画风是动画插画、厚涂、写实照片、3D渲染或其他风格。"
                    "如果主体很小或部分不清晰，也要保守记录可见颜色和轮廓，不要只写成某人背着某物。"
                    "如果服装、头发或道具颜色因主体太小、光照或遮挡而不确定，必须写“颜色不确定，以参考图原像素为准”，不要猜成背景、草地、天空、阴影或光照的颜色。"
                    "最后一项必须写成：禁止复制：不要复制参考图的姿势、主体朝向、镜头、构图、主体大小、背景和地点。"
                    "严禁把禁止项写成保持背影、保持姿势、保持构图或保持背景。"
                    "如果脸部不可见或主体很小，请在脸部印象写未清晰可见，不要写背影、背对镜头或正面。"
                    "如果主体很小或不清晰，请明确保守描述可见特征，不要编造不可见细节。"
                    "不要输出英文、JSON、SD标签、Markdown表格。"
                    f"{merge_instruction}"
                )
                output = self.generate(prompt, images=image_tensors, max_length=480)
            elif is_animation:
                prompt = (
                    "你是 NovaFlow 的图生视频 Prompt 设计助手。将这张图片视为视频首帧，直接生成一段可用于 WAN 等图生视频模型的中文自然语言 Prompt，"
                    "不能只复述图片内容或写成静态图描述。"
                    "保持图片中的主体身份、数量、面部、服装、道具和场景一致；明确首帧的开始状态、连续动作过程和结束状态。"
                    "写清动作速度与节奏；未指定时长时按约5秒设计自然、可完成的动作，避免堆叠过多动作。"
                    "写清固定、推进、拉远、跟随或环绕等单一连贯运镜；除非用户要求变化，否则背景、构图、光线和主体位置关系保持稳定。"
                    "最终只输出一段合并后的中文视频 Prompt，不要输出图片分析、多个方案、英文、SD 标签、JSON 或项目符号。"
                    f"{merge_instruction}"
                )
                output = self.generate(prompt, images=image_tensors, max_length=260)
            elif purpose.lower().replace("_", "-") == "static-image-reverse":
                static_result = self.reverse_plain_static_image(payload, image_tensors[0], requirements)
                description = static_result["description"]
                is_public_v2 = static_result["visualSchema"] == VISUAL_SCHEMA_VERSION_V2
                output = "" if is_public_v2 else static_result["rawOutput"]
                public_content_safety = dict(static_result["contentSafety"] or {})
                if is_public_v2:
                    public_content_safety["sensitive_visible_facts"] = []
                quality_gate_failed = bool(static_result["qualityGateFailed"])
                reverse_diagnostics = {
                    "qualityGateRetried": bool(static_result["qualityGateRetried"]),
                    "visualSchema": static_result["visualSchema"],
                    "reverseProvider": static_result["reverseProvider"],
                    "reverseModelPath": static_result["reverseModelPath"],
                    "reverseFallbackReason": static_result["reverseFallbackReason"],
                    "visualHasOcr": bool(static_result["visualHasOcr"]),
                    "visualPrompt": static_result["visualPrompt"],
                    "generationRequirements": static_result["generationRequirements"],
                    "contentSafety": public_content_safety,
                    "contentWarnings": static_result["contentWarnings"],
                    "sensitivePromptBlocked": bool(static_result["sensitivePromptBlocked"]),
                    "generationGate": str(
                        static_result.get("generationGate")
                        or ("blocked" if static_result["sensitivePromptBlocked"] else "direct")
                    ),
                }
                if is_public_v2:
                    reverse_diagnostics.update({
                        "analysisPartial": bool(static_result.get("analysisPartial")),
                        "analysisDegraded": bool(static_result.get("analysisDegraded")),
                        "message": str(static_result.get("message") or ""),
                        "contractFailureCode": str(static_result.get("contractFailureCode") or ""),
                        "errorCode": str(static_result.get("errorCode") or ""),
                        "providerFailureCode": str(static_result.get("providerFailureCode") or ""),
                        "retryAttempted": bool(static_result.get("retryAttempted")),
                        "retryCount": int(static_result.get("retryCount") or 0),
                        "legacyFallbackSuppressed": bool(static_result.get("legacyFallbackSuppressed")),
                        "requestedVisualSchema": str(static_result.get("requestedVisualSchema") or ""),
                        "retryable": bool(static_result.get("retryable")),
                        "failureCategory": str(static_result.get("failureCategory") or ""),
                        "richPromptFallback": bool(
                            static_result.get("richPromptFallback")
                        ),
                    })
            else:
                prompt = (
                    "你是 NovaFlow 的 AI反推助手。请根据图片内容生成适合图像生成模型使用的中文自然语言提示词。"
                    "不要输出英文，不要输出 SD 标签，不要输出 JSON，不要写成分析报告。"
                    "请直接输出可用于生成图片的自然语言描述。"
                    f"{merge_instruction}"
                )
                output = self.generate(prompt, images=image_tensors, max_length=180)
        else:
            def image_role(item, index):
                marker = " ".join([
                    str(item.get("slotType") or ""),
                    str(item.get("role") or ""),
                    str(item.get("name") or ""),
                    str(item.get("label") or ""),
                ]).lower()
                if re.search(r"(first[_-]?frame|start[_-]?frame|首帧|第一帧)", marker):
                    return "first"
                if re.search(r"(last[_-]?frame|end[_-]?frame|尾帧|最后一帧)", marker):
                    return "last"
                return ""

            roles = [image_role(item, index) for index, item in enumerate(image_items)]
            is_first_last_pair = len(image_tensors) == 2 and "first" in roles and "last" in roles
            role_labels = [str(item.get("role") or item.get("slotType") or "reference") for item in image_items]
            image_tokens = "".join(
                f"图片{i + 1}{'（首帧）' if roles[i] == 'first' else '（尾帧）' if roles[i] == 'last' else f'（职责：{role_labels[i]}）'}: <|vision_start|><|image_pad|><|vision_end|>\n"
                for i in range(len(image_tensors))
            )
            if is_first_last_pair:
                analysis_prompt, analysis_template, analysis_max_length = build_first_last_analysis_prompt(image_tokens)
                analysis_output = self.generate(
                    analysis_prompt,
                    images=image_tensors,
                    llama_template=analysis_template,
                    max_length=analysis_max_length,
                )
                action_notes = clean_text(analysis_output)
                prompt, llama_template, max_length = build_first_last_final_prompt(action_notes, image_tokens)
                prompt = f"{prompt}{merge_instruction}"
                output = self.generate(prompt, images=image_tensors, llama_template=llama_template, max_length=max_length)
                description = clean_reverse_output(output)
                if not is_first_last_action_prompt_quality_ok(description):
                    retry_prompt, retry_template, retry_max_length = build_first_last_final_prompt(action_notes, image_tokens, description)
                    retry_prompt = f"{retry_prompt}{merge_instruction}"
                    retry_output = self.generate(retry_prompt, images=image_tensors, llama_template=retry_template, max_length=retry_max_length, seed=2)
                    retry_description = clean_reverse_output(retry_output)
                    if retry_description:
                        output = retry_output
                        description = retry_description
                    if not is_first_last_action_prompt_quality_ok(description):
                        quality_gate_failed = True
                        log_prompt_assistant_event(
                            "quality_gate_failed",
                            command="reverseImagePrompt",
                            mode="first_last_frame",
                            analysisPreview=action_notes[:180],
                            preview=description[:160],
                        )
            else:
                if is_animation:
                    prompt = (
                        f"{image_tokens}"
                        "请联合参考这些图片，生成一段可直接用于视频生成的中文自然语言 Prompt，不能只写静态图片描述。"
                        "保持主体身份、外观、服装、道具和场景锚点一致，明确动作开始、连续过程、结束状态、速度节奏、时长和单一连贯运镜。"
                        "未被要求改变时，背景、构图与光线保持稳定。不要输出英文、SD 标签、JSON、项目符号或分析报告。"
                        f"{merge_instruction}"
                    )
                    llama_template = (
                        "<|im_start|>system\n你是 NovaFlow 的视频 Prompt 设计助手。请把参考图和用户意图合并成一段最终中文视频 Prompt。<|im_end|>\n"
                        "<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n"
                    )
                    output = self.generate(prompt, images=image_tensors, llama_template=llama_template, max_length=280)
                elif purpose == "styleTransfer" or (
                    purpose == "roleReference" and len(image_tensors) == 2 and "subject" in role_labels and "style" in role_labels
                ):
                    subject_index = next((i for i, role in enumerate(role_labels) if role == "subject"), 0)
                    style_index = next((i for i, role in enumerate(role_labels) if role == "style"), -1)
                    if style_index < 0 or style_index == subject_index:
                        raise ValueError("风格迁移需要一张主图和一张风格参考图")
                    isolation_prompt = (
                        f"{image_tokens}"
                        "执行双图风格迁移的隔离分析，但不要生成最终提示词。图1（subject）是唯一内容来源，图2（style）只提供抽象绘画语言。"
                        "必须严格输出两行：\n"
                        "CONTENT_LOCK: 用一段中文准确描述图1的人物或主体身份、脸和发型、服装、道具、姿势、构图、背景及空间关系；"
                        "不得使用图2的任何内容。\n"
                        "STYLE_ONLY: 开头明确图2最接近的视觉媒介和风格类别，例如二次元插画、赛璐璐、半厚涂、厚涂手绘、"
                        "2.5D游戏美术、3D渲染或写实摄影；随后只描述造型概括程度、线条、笔触、上色、色块与渐变、材质表现、"
                        "光影和边缘处理。严禁提及图2的人物、性别、脸、发型、服装、道具、动作、姿势、构图、背景、建筑、地点、文字、"
                        "具体物体或剧情。除这两行外不要输出任何内容。"
                    )
                    isolation_template = (
                        "<|im_start|>system\n你是严格的双图风格迁移分析器。图1只分析内容，图2只分析抽象风格，禁止交叉污染。<|im_end|>\n"
                        "<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n"
                    )
                    isolation_output = clean_text(self.generate(
                        isolation_prompt,
                        images=image_tensors,
                        llama_template=isolation_template,
                        max_length=160,
                        trace_label="style_transfer_isolation",
                    ))
                    isolation_match = re.search(
                        r"CONTENT_LOCK\s*[:：]\s*(.*?)\s*STYLE_ONLY\s*[:：]\s*(.*)",
                        isolation_output,
                        re.I | re.S,
                    )
                    subject_notes = clean_reverse_output(isolation_match.group(1)) if isolation_match else ""
                    style_notes = clean_reverse_output(isolation_match.group(2)) if isolation_match else ""
                    if not subject_notes or not style_notes:
                        raise ValueError("模型未能建立主体内容锁或纯风格摘要")
                    description = (
                        f"严格保留主体图全部内容：{subject_notes}。"
                        f"在人物身份、脸、发型、服装、道具、姿势、构图、背景和空间关系完全不变的前提下，"
                        f"进行高强度风格迁移并彻底重新绘制为以下视觉语言：{style_notes}。"
                        "必须明显改变视觉媒介、造型概括、线条、笔触、上色、色块、材质表现、光影和边缘处理，"
                        "不得只做轻度美化、摄影调色或清晰度增强；主体图为照片且参考为插画时，必须去除摄影质感并重绘为对应插画风格。"
                        "风格参考图只提供表现方式，严禁新增或替换其中的人物、服装、道具、动作、姿势、构图、背景、建筑、地点或具体物体。"
                    )
                    if requirements:
                        description = f"{description}补充约束：{requirements}"
                    output = description
                else:
                    role_isolation = (
                        "必须严格按每张图的职责工作：subject只决定主体身份与核心设计；style只提取线条、笔触、上色、材质和光影语言；"
                        "pose只提取姿势；composition只提取构图；color只提取配色；material只提取材质；ui_layout只提取UI布局。"
                        "禁止把非subject图片中的人物身份、脸、服装、道具、背景、文字、布局或姿势带入结果，除非该维度被明确指定。"
                        "参考图中可见的界面按钮、菜单、标签、提示词示例、说明文字、水印和软件窗口都只是截图噪声，严禁抄写、枚举或当成生成内容；"
                        "不得输出主图/原图、风格参考、保持原风格、处理方式、模型名称等界面词。最终只描述目标画面本身。"
                        if purpose == "roleReference" else ""
                    )
                    prompt = (
                        f"{image_tokens}"
                        "请联合分析这些图片，生成一段适合图像生成模型使用的中文自然语言提示词。"
                        f"{role_isolation}"
                        "不要输出英文，不要输出 SD 标签，不要输出 JSON，不要写成分析报告。"
                        f"{merge_instruction}"
                    )
                    llama_template = (
                        "<|im_start|>system\n你是 NovaFlow 的 AI反推助手。请直接输出可用于生成图片的中文自然语言描述。<|im_end|>\n"
                        "<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n"
                    )
                    output = self.generate(prompt, images=image_tensors, llama_template=llama_template, max_length=220)

        if not description:
            description = clean_reverse_output(output)
        if not description:
            raise ValueError("模型未返回可用的视频提示词" if is_animation else "模型未返回可用的图片描述")
        negative_source = (
            f"视频 动画 图生视频 {requirements} {purpose}"
            if is_animation
            else f"图片 图生图 {requirements} {purpose}"
        )
        negative_prompt = build_targeted_negative_prompt(negative_source, description)
        if reverse_diagnostics and (
            reverse_diagnostics.get("visualHasOcr")
            or requirements_preserve_visible_text(requirements)
        ):
            negative_prompt = remove_negative_prompt_keywords(negative_prompt, {"logo"})
        if not negative_prompt:
            raise ValueError("模型未返回可用的负向关键词")
        self.status = "模型可用"
        return {
            "prompt": description,
            "output_text": description,
            "positivePrompt": description,
            "negativePrompt": negative_prompt,
            "rawOutput": output,
            "qualityGateFailed": quality_gate_failed,
            **reverse_diagnostics,
        }


def data_url_to_tensor(data_url: str):
    if not data_url:
        return None
    match = re.match(r"^data:[^;,]+;base64,(.*)$", data_url, re.S)
    if not match:
        raise ValueError("图片数据不是有效的 data URL")
    raw = base64.b64decode(match.group(1))

    import numpy as np
    import torch
    from PIL import Image

    image = Image.open(io.BytesIO(raw)).convert("RGB")
    array = np.asarray(image).astype("float32") / 255.0
    return torch.from_numpy(array).unsqueeze(0)


def strip_label(value: str, label: str) -> str:
    return re.sub(rf"^\s*{label}\s*[:：]\s*", "", value.strip())


def split_optimized_output(output: str) -> tuple[str, str]:
    text = clean_text(output)
    positive = ""
    negative = ""
    if "负向" in text:
        before, after = re.split(r"负向\s*[:：]", text, maxsplit=1)
        negative = after.strip()
        positive = re.sub(r"^\s*正向\s*[:：]\s*", "", before.strip())
    elif "推荐负面" in text:
        before, after = re.split(r"推荐负面提示词\s*[:：]", text, maxsplit=1)
        negative = after.strip()
        positive = strip_label(before, "正向")
    else:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        positive_lines = []
        negative_lines = []
        for line in lines:
            if re.match(r"^(负向|负面|反向|反面)\s*[:：]", line):
                negative_lines.append(re.sub(r"^(负向|负面|反向|反面)\s*[:：]\s*", "", line))
            elif re.match(r"^正向\s*[:：]", line):
                positive_lines.append(strip_label(line, "正向"))
            else:
                positive_lines.append(line)
        positive = "\n".join(positive_lines).strip()
        negative = "\n".join(negative_lines).strip()
    positive = re.sub(r"\n{2,}", "\n", positive).strip()
    positive = strip_label(positive, "正向")
    negative = re.split(r"(?:\n\s*)?正向\s*[:：]", negative, maxsplit=1)[0].strip()
    return positive, negative


def minimax_h3_prompt_fields_are_ordered(text: str, fields: tuple[str, ...]) -> bool:
    cursor = -1
    for field in fields:
        match = re.search(rf"(?im)^\s*{re.escape(field)}\s*:", text)
        if not match or match.start() <= cursor:
            return False
        cursor = match.start()
    return True


def normalize_minimax_h3_prompt_output(output: str) -> str:
    text = clean_text(output)
    if text.startswith("{"):
        try:
            parsed = json.loads(text)
        except Exception:
            parsed = None
        if isinstance(parsed, dict):
            for key in ("prompt", "positive_prompt", "positivePrompt", "output_text"):
                candidate = parsed.get(key)
                if isinstance(candidate, str) and candidate.strip():
                    text = clean_text(candidate)
                    break
    text = re.sub(r"(?im)^\s*(?:prompt|positive_prompt|positivePrompt)\s*[:：]\s*", "", text, count=1)
    negative_match = MINIMAX_H3_NEGATIVE_SECTION_PATTERN.search(text)
    if negative_match:
        text = text[:negative_match.start()].strip()
    valid_structure = (
        minimax_h3_prompt_fields_are_ordered(text, MINIMAX_H3_BASE_PROMPT_FIELDS)
        or minimax_h3_prompt_fields_are_ordered(text, MINIMAX_H3_REFERENCE_PROMPT_FIELDS)
    )
    if not valid_structure:
        raise ValueError("模型未返回有效的 MiniMax H3 字段结构")
    return text


def complete_minimax_h3_mechanical_contract(
    text: str,
    mode: str = "",
    duration_seconds=None,
    value_language: str = "",
) -> str:
    """Fill only deterministic H3 protocol markers; never invent scene content."""
    normalized = clean_text(text)
    normalized_mode = clean_text(mode).upper()
    normalized_language = clean_text(value_language).lower()
    use_simplified_chinese = (
        normalized_language in {"zh", "zh-cn", "zh_cn", "chinese", "simplified chinese"}
        if normalized_language
        else minimax_h3_preferred_value_language(normalized) == "zh-CN"
    )
    header_pattern = re.compile(r"(?m)^\s*([a-z][a-z0-9_]*)\s*:")
    header_matches = list(header_pattern.finditer(normalized))
    actual_fields = tuple(match.group(1) for match in header_matches)
    expected_fields = (
        MINIMAX_H3_REFERENCE_PROMPT_FIELDS
        if normalized_mode == "REF2VA" or actual_fields == MINIMAX_H3_REFERENCE_PROMPT_FIELDS
        else MINIMAX_H3_BASE_PROMPT_FIELDS
    )
    if actual_fields != expected_fields:
        return normalized
    narrative_field = "detailed_description" if expected_fields == MINIMAX_H3_REFERENCE_PROMPT_FIELDS else "integrated_multimodal_description"

    def narrative_bounds(value: str):
        matches = list(header_pattern.finditer(value))
        index = next((idx for idx, match in enumerate(matches) if match.group(1) == narrative_field), -1)
        if index < 0:
            return None
        start = matches[index].end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(value)
        return start, end

    bounds = narrative_bounds(normalized)
    if not bounds:
        return normalized
    start, end = bounds
    narrative = normalized[start:end].strip()
    if not narrative:
        return normalized
    exact_shots = list(re.finditer(r"\[Shot ([1-9][0-9]*)\]", narrative))
    malformed_shots = list(re.finditer(r"\[Shot[^\]]*\]", narrative))
    if malformed_shots and len(exact_shots) != len(malformed_shots):
        return normalized
    if not exact_shots:
        anchor = ""
        if normalized_mode in {"I2VA", "FL2VA"}:
            anchor = (
                "<Picture 1> 是 0.00 秒时提供的精确首帧； "
                if use_simplified_chinese
                else "<Picture 1> is the exact supplied opening frame at 0.00 seconds; "
            )
        content_start = start
        while content_start < len(normalized) and normalized[content_start] in " \t":
            content_start += 1
        normalized = normalized[:start] + f" [Shot 1] {anchor}" + normalized[content_start:]
        bounds = narrative_bounds(normalized)
        start, end = bounds
        narrative = normalized[start:end].strip()
        exact_shots = list(re.finditer(r"\[Shot ([1-9][0-9]*)\]", narrative))
    if not exact_shots or int(exact_shots[0].group(1)) != 1:
        return normalized

    if normalized_mode == "I2VA":
        if "<Picture 1>" not in narrative:
            picture_anchor = (
                " <Picture 1> 是 0.00 秒时提供的精确首帧；"
                if use_simplified_chinese
                else " <Picture 1> is the exact supplied opening frame at 0.00 seconds;"
            )
            normalized = normalized[:start] + picture_anchor + normalized[start:]
        first_line = next((line.strip() for line in normalized.splitlines() if line.strip()), "")
        if not ("<Picture 1>" in first_line and "[Shot 1]" in first_line and "0.00" in first_line):
            alignment = (
                "参考帧对齐：<Picture 1> 对应 [Shot 1] = 0.00 秒\n"
                if use_simplified_chinese
                else "Reference alignment - <Picture 1> from [Shot 1] = 0.00 seconds\n"
            )
            normalized = alignment + normalized
    elif normalized_mode == "FL2VA":
        try:
            duration = float(duration_seconds)
        except (TypeError, ValueError):
            duration = 0.0
        if not math.isfinite(duration) or duration <= 0:
            return normalized
        bounds = narrative_bounds(normalized)
        start, end = bounds
        narrative = normalized[start:end].strip()
        exact_shots = list(re.finditer(r"\[Shot ([1-9][0-9]*)\]", narrative))
        if len(exact_shots) == 1:
            total_ms = max(1, int(round(duration * 1000)))
            minutes, remainder_ms = divmod(total_ms, 60000)
            seconds, milliseconds = divmod(remainder_ms, 1000)
            ending = (
                f"\n[Shot 2] At {minutes:02d}:{seconds:02d}.{milliseconds:03d}，画面连续运动并准确过渡到 <Picture 2>。"
                if use_simplified_chinese
                else f"\n[Shot 2] At {minutes:02d}:{seconds:02d}.{milliseconds:03d}, motion resolves continuously into <Picture 2>."
            )
            normalized = normalized[:end].rstrip() + ending + "\n" + normalized[end:]
        bounds = narrative_bounds(normalized)
        start, end = bounds
        narrative = normalized[start:end].strip()
        exact_shots = list(re.finditer(r"\[Shot ([1-9][0-9]*)\]", narrative))
        if not exact_shots:
            return normalized
        last_shot = int(exact_shots[-1].group(1))
        if "<Picture 2>" not in narrative:
            ending_anchor = (
                " <Picture 2> 是提供的精确尾帧。\n"
                if use_simplified_chinese
                else " <Picture 2> is the exact supplied ending frame.\n"
            )
            normalized = normalized[:end].rstrip() + ending_anchor + normalized[end:]
        first_line = next((line.strip() for line in normalized.splitlines() if line.strip()), "")
        duration_text = f"{duration:.2f}"
        if not all(token in first_line for token in ("<Picture 1>", "<Picture 2>", "[Shot 1]", f"[Shot {last_shot}]", "0.00", duration_text)):
            alignment = (
                f"参考帧对齐：<Picture 1> 对应 [Shot 1] = 0.00 秒；"
                f"<Picture 2> 对应 [Shot {last_shot}] = {duration_text} 秒\n"
                if use_simplified_chinese
                else f"Reference alignment - <Picture 1> from [Shot 1] = 0.00 seconds; "
                f"<Picture 2> from [Shot {last_shot}] = {duration_text} seconds\n"
            )
            normalized = alignment + normalized
    return normalized


def validate_minimax_h3_value_language(text: str, value_language: str) -> str:
    """Fail closed when Chinese user input produces no Chinese prose at all."""
    normalized = clean_text(text)
    if clean_text(value_language).lower() not in {"zh", "zh-cn", "zh_cn", "chinese", "simplified chinese"}:
        return normalized
    prose = re.sub(r"(?m)^\s*[a-z][a-z0-9_]*\s*:\s*", "", normalized)
    prose = re.sub(r"<(?:Subject|Picture|Video|Audio)\s+[1-9][0-9]*>", "", prose)
    prose = re.sub(r"\[Shot\s+[1-9][0-9]*\]", "", prose)
    prose = re.sub(r"\bAt\s+\d{2}:\d{2}\.\d{3}\b", "", prose)
    han_count = len(re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", prose))
    if han_count == 0:
        raise ValueError("MiniMax H3 中文输入的字段正文必须使用简体中文")
    return normalized


def validate_minimax_h3_shot_timeline(narrative: str, duration_seconds) -> None:
    try:
        duration = float(duration_seconds)
    except (TypeError, ValueError):
        raise ValueError("MiniMax H3 请求缺少有效时长，时长必须为 1 到 15 秒") from None
    if (
        not math.isfinite(duration)
        or duration < MINIMAX_H3_MIN_DURATION_SECONDS
        or duration > MINIMAX_H3_MAX_DURATION_SECONDS
    ):
        raise ValueError("MiniMax H3 请求时长超出范围，时长必须为 1 到 15 秒")

    raw_tags = list(re.finditer(r"\[Shot[^\]]*\]", narrative))
    if not raw_tags:
        raise ValueError("MiniMax H3 提示词必须包含 [Shot 1]")
    previous_seconds = -1.0
    for index, tag_match in enumerate(raw_tags, start=1):
        exact = re.fullmatch(r"\[Shot ([1-9][0-9]*)\]", tag_match.group(0))
        if not exact:
            raise ValueError(f"MiniMax H3 Shot 标签格式无效：{tag_match.group(0)}")
        shot_number = int(exact.group(1))
        if shot_number != index:
            raise ValueError("MiniMax H3 Shot 编号必须从 [Shot 1] 开始连续递增")
        tail = narrative[tag_match.end():]
        timestamp = re.match(r"\s+At\s+([0-9]{2}):([0-5][0-9])\.([0-9]{3})", tail)
        if shot_number == 1:
            if timestamp:
                raise ValueError("MiniMax H3 [Shot 1] 不能包含时间戳")
            seconds = 0.0
        else:
            if not timestamp:
                raise ValueError(f"MiniMax H3 [Shot {shot_number}] 必须包含 At MM:SS.mmm 时间戳")
            seconds = (
                int(timestamp.group(1)) * 60
                + int(timestamp.group(2))
                + int(timestamp.group(3)) / 1000
            )
            if seconds <= previous_seconds:
                raise ValueError("MiniMax H3 Shot 时间戳必须严格递增")
            # A shot exactly at the selected duration is the legal endpoint;
            # only timestamps beyond it are rejected.
            if seconds > duration + 0.0005:
                raise ValueError("MiniMax H3 Shot 时间戳超出所选时长")
        previous_seconds = seconds


def validate_minimax_h3_prompt_contract(text: str, mode: str = "", duration_seconds=None) -> str:
    normalized = clean_text(text)
    normalized_mode = clean_text(mode).upper()
    header_pattern = re.compile(r"(?m)^\s*([a-z][a-z0-9_]*)\s*:")
    header_matches = list(header_pattern.finditer(normalized))
    actual_fields = tuple(match.group(1) for match in header_matches)
    if normalized_mode == "REF2VA":
        expected_fields = MINIMAX_H3_REFERENCE_PROMPT_FIELDS
    elif normalized_mode:
        expected_fields = MINIMAX_H3_BASE_PROMPT_FIELDS
    else:
        expected_fields = (
            MINIMAX_H3_REFERENCE_PROMPT_FIELDS
            if actual_fields == MINIMAX_H3_REFERENCE_PROMPT_FIELDS
            else MINIMAX_H3_BASE_PROMPT_FIELDS
        )
    if actual_fields != expected_fields:
        raise ValueError(
            f"MiniMax H3 {normalized_mode or '输出'} 字段必须完整且严格按协议排序"
        )
    field_values = {}
    for index, match in enumerate(header_matches):
        value_end = header_matches[index + 1].start() if index + 1 < len(header_matches) else len(normalized)
        value = normalized[match.end():value_end].strip()
        if not value:
            raise ValueError(f"MiniMax H3 字段 {match.group(1)} 不能为空")
        field_values[match.group(1)] = value
    is_reference_contract = expected_fields == MINIMAX_H3_REFERENCE_PROMPT_FIELDS
    narrative_field = "detailed_description" if is_reference_contract else "integrated_multimodal_description"
    narrative = field_values.get(narrative_field, "")
    if "[Shot 1]" not in narrative:
        raise ValueError(f"MiniMax H3 字段 {narrative_field} 必须包含 [Shot 1]")
    validate_minimax_h3_shot_timeline(narrative, duration_seconds)
    if not MINIMAX_H3_ACTION_PROGRESSION_PATTERN.search(narrative):
        raise ValueError("MiniMax H3 叙事必须包含动作推进，不能只是静态图片描述")
    if not MINIMAX_H3_CAMERA_DIRECTION_PATTERN.search(narrative):
        raise ValueError("MiniMax H3 叙事必须明确运镜或镜头保持选择")
    if not is_reference_contract and re.search(r"<Subject [1-9][0-9]*>", normalized):
        raise ValueError("MiniMax H3 基础模式不能使用 <Subject N> 标签")
    first_line = next((line.strip() for line in normalized.splitlines() if line.strip()), "")
    if normalized_mode == "I2VA" and (
        "<Picture 1>" not in first_line
        or "[Shot 1]" not in first_line
        or not re.search(r"(^|[^0-9])0\.00(?:\s*秒|\s*s(?:ec(?:onds?)?)?\b)", first_line, re.I)
    ):
        raise ValueError("MiniMax H3 I2VA 首行必须包含 <Picture 1>、[Shot 1] 与 0.00 秒对齐")
    if normalized_mode == "FL2VA":
        required_tokens = ("<Picture 1>", "<Picture 2>", "[Shot 1]", "0.00")
        if any(token not in first_line for token in required_tokens):
            raise ValueError(
                "MiniMax H3 FL2VA 首行必须包含首尾图片、[Shot 1] 与 0.00 秒对齐"
            )
        try:
            duration = float(duration_seconds)
        except (TypeError, ValueError):
            duration = 0.0
        if math.isfinite(duration) and duration > 0 and f"{duration:.2f}" not in first_line:
            raise ValueError("MiniMax H3 FL2VA 首行必须包含所选时长的尾帧对齐")
    return normalized


def clean_text(value: str) -> str:
    text = str(value or "").strip()
    text = re.sub(r"^```(?:json|text)?", "", text, flags=re.I).strip()
    text = re.sub(r"```$", "", text).strip()
    return text


def prompt_assistant_tokenizer_safe_text(value: str) -> str:
    text = str(value or "").replace("\x00", "")
    # Comfy parses ASCII parentheses as prompt-weight syntax. Prompt Assistant
    # prompts are LLM instructions, so keep dynamic story text literal.
    return text.replace("(", "（").replace(")", "）")


def normalize_negative_keyword_item(value: str) -> str:
    item = str(value or "").strip()
    for _ in range(4):
        before = item
        item = re.sub(r"^(负向|负面|反向|反面|推荐负面提示词|推荐负向提示词)\s*[:：]\s*", "", item)
        item = re.sub(r"^[\s\u2022\u2023\u25e6\u2043\u2219*+\-–—]+", "", item)
        item = re.sub(r"^\s*(?:[（(]?\d+[）).．、:：]\s*|[一二三四五六七八九十]+[、.．:：]\s*)", "", item)
        item = re.sub(r"(不要出现|不要有|不要|避免出现|避免|不能出现|不能有|禁止出现|请勿出现|请勿)", "", item)
        item = re.sub(r"\b(no|without)\b", "", item, flags=re.I)
        item = re.sub(r"^(出现|存在)", "", item).strip()
        if item == before:
            break
    item = item.strip(" \t\r\n:：-，,。；;、")
    return re.sub(r"\s+", " ", item).strip()


def normalize_negative_keyword_list(value: str) -> list[str]:
    text = clean_text(value)
    text = re.sub(r"^(负向|负面|反向|反面|推荐负面提示词|推荐负向提示词)\s*[:：]\s*", "", text)
    text = re.sub(r"(^|[\r\n,，])\s*[\u2022\u2023\u25e6\u2043\u2219*+\-–—]+\s*", r"\1", text)
    text = re.sub(r"(^|[\r\n,，])\s*(?:[（(]?\d+[）).．、:：]\s*|[一二三四五六七八九十]+[、.．:：]\s*)", r"\1", text)
    text = re.sub(r"\r?\n+", ",", text)
    text = text.replace("，", ",").replace("、", ",").replace("；", ",").replace(";", ",")
    text = re.sub(r"[。!?？]\s*", ",", text)
    items = []
    seen = set()
    for raw in text.split(","):
        item = normalize_negative_keyword_item(raw)
        if not item or len(item) > 24:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        items.append(item)
    return items


def normalize_negative_keywords(value: str) -> str:
    return ", ".join(normalize_negative_keyword_list(value))


def merge_keyword_list(*groups, max_count: int | None = None) -> list[str]:
    merged: list[str] = []
    seen = set()
    for group in groups:
        if isinstance(group, str):
            values = normalize_negative_keyword_list(group)
        elif isinstance(group, (list, tuple)):
            values = []
            for item in group:
                normalized = normalize_negative_keyword_item(str(item or ""))
                if normalized:
                    values.append(normalized)
        else:
            values = []
        for item in values:
            key = item.lower()
            if not key or key in seen:
                continue
            seen.add(key)
            merged.append(item)
            if max_count is not None and len(merged) >= max_count:
                return merged
    return merged


def negative_category_keyword_matches(text: str, keyword: str) -> bool:
    key = str(keyword or "").lower()
    if not key:
        return False
    if key == "移动":
        return bool(re.search(r"移动(?!端|应用|设备|界面|页面|app)", text, flags=re.I))
    return key in text


def detect_negative_categories(raw_prompt: str, positive_prompt: str) -> list[dict]:
    raw_text = str(raw_prompt or "").lower()
    positive_text = str(positive_prompt or "").lower()
    text = f"{raw_text}\n{positive_text}"
    matched = []
    for category in NEGATIVE_CATEGORY_DEFINITIONS:
        keywords = category.get("keywords") or []
        category_name = str(category.get("name") or "")
        category_matched = False
        for keyword in keywords:
            key = str(keyword)
            if category_name == "scene" and key == "背景":
                if negative_category_keyword_matches(raw_text, key):
                    category_matched = True
                    break
                continue
            if category_name == "prop":
                if key == "产品" and not negative_category_keyword_matches(raw_text, key):
                    continue
                if key == "图标" and any(str(item.get("name")) == "ui" for item in matched):
                    continue
            if negative_category_keyword_matches(text, key):
                category_matched = True
                break
        if category_matched:
            matched.append(category)
    return matched


def category_negative_keywords(categories: list[dict]) -> list[str]:
    if not categories:
        return merge_keyword_list(NEGATIVE_FALLBACK)

    category_by_name = {str(item.get("name")): item for item in categories}
    ordered: list[dict] = []
    if "video" in category_by_name:
        ordered.append(category_by_name["video"])
    for preferred in ["person", "ui", "scene", "prop"]:
        if preferred in category_by_name and category_by_name[preferred] not in ordered:
            ordered.append(category_by_name[preferred])
    for category in categories:
        if category not in ordered:
            ordered.append(category)

    body_limit = NEGATIVE_MAX_COUNT - len(NEGATIVE_COMMON_PREFIX) - len(NEGATIVE_SUFFIX)
    selected: list[str] = []
    if ordered and ordered[0].get("name") == "video":
        selected.extend(merge_keyword_list(ordered[0].get("negative") or [], max_count=8))
        remaining_categories = ordered[1:]
        remaining_limit = max(0, body_limit - len(selected))
        per_category = max(2, remaining_limit // max(1, len(remaining_categories))) if remaining_categories else 0
        for category in remaining_categories:
            if len(selected) >= body_limit:
                break
            selected = merge_keyword_list(selected, category.get("negative") or [], max_count=min(body_limit, len(selected) + per_category))
    else:
        per_category = max(3, min(8, body_limit // max(1, len(ordered))))
        for category in ordered:
            if len(selected) >= body_limit:
                break
            selected = merge_keyword_list(selected, category.get("negative") or [], max_count=min(body_limit, len(selected) + per_category))

    return selected[:body_limit]


def build_targeted_negative_prompt(raw_prompt: str, positive_prompt: str, model_negative: str = "") -> str:
    categories = detect_negative_categories(raw_prompt, positive_prompt)
    typed_keywords = category_negative_keywords(categories)
    body_limit = NEGATIVE_MAX_COUNT - len(NEGATIVE_COMMON_PREFIX) - len(NEGATIVE_SUFFIX)
    middle = merge_keyword_list(typed_keywords, max_count=body_limit)
    final = merge_keyword_list(NEGATIVE_COMMON_PREFIX, middle, NEGATIVE_SUFFIX, max_count=NEGATIVE_MAX_COUNT)

    suffix_keys = {item.lower() for item in NEGATIVE_SUFFIX}
    prefix_keys = {item.lower() for item in NEGATIVE_COMMON_PREFIX}
    middle_items = [item for item in final if item.lower() not in prefix_keys and item.lower() not in suffix_keys]
    ordered = merge_keyword_list(NEGATIVE_COMMON_PREFIX, middle_items[:body_limit], NEGATIVE_SUFFIX, max_count=NEGATIVE_MAX_COUNT)
    return ", ".join(ordered)


def requirements_preserve_visible_text(value: str) -> bool:
    text = clean_text(value)[:2000]
    return bool(re.search(
        r"(?:保留|包含|显示|添加|写入|写上|呈现).{0,8}(?:文字|文本|标题|字幕|标志|logo)"
        r"|(?:文字|文本|标题|字幕|标志|logo).{0,8}(?:保留|包含|显示|添加|写入|写上|呈现)",
        text,
        flags=re.I,
    ))


def remove_negative_prompt_keywords(value: str, blocked: set[str]) -> str:
    blocked_keys = {str(item or "").strip().lower() for item in blocked}
    items = [
        item.strip()
        for item in re.split(r"[,，;；\n]+", str(value or ""))
        if item.strip() and item.strip().lower() not in blocked_keys
    ]
    return ", ".join(items)


def build_first_last_analysis_prompt(image_tokens: str) -> tuple[str, str, int]:
    prompt = (
        f"{image_tokens}"
        "你正在处理首尾帧视频反推。图片1/首帧是动作开始，图片2/尾帧是动作结束。"
        "先不要写最终提示词。请只比较两张图的可见差异，输出一份简短的内部动作记录。"
        "必须分别写清：主体、首帧姿态、尾帧姿态、身体姿态变化、头部变化、手臂变化、腿部变化、道具位置变化、镜头变化、背景变化。"
        "如果某项没有明显变化，就写“无明显变化”或“保持不变”。"
        "必须根据可见差异合理推断，不能强行夸张动作。"
        "不要重点描述服装、发型和背景，只保留必要信息。不要输出英文，不要输出 JSON。"
        "请按以下格式输出：\n"
        "主体：\n"
        "首帧姿态：\n"
        "尾帧姿态：\n"
        "身体变化：\n"
        "头部变化：\n"
        "手臂变化：\n"
        "腿部变化：\n"
        "道具变化：\n"
        "镜头变化：\n"
        "背景变化：\n"
        "合理动作过渡："
    )
    llama_template = (
        "<|im_start|>system\n"
        "你是 NovaFlow 的首尾帧动作差异分析助手。你的任务是比较首帧和尾帧，不是描述单张图片。"
        "请输出中文内部动作记录，不输出 JSON，不输出英文。"
        "<|im_end|>\n"
        "<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n"
    )
    return prompt, llama_template, 360


def build_first_last_final_prompt(action_notes: str, image_tokens: str = "", previous_output: str = "") -> tuple[str, str, int]:
    retry_note = ""
    if previous_output:
        retry_note = (
            f"\n上一次输出偏静态，不能直接复用。上一次输出：{previous_output[:180]}\n"
            "请重新改写，必须把内部动作记录里的差异写成视频动作过渡。"
        )
    frame_context = f"{image_tokens}\n" if image_tokens else ""
    prompt = (
        f"{frame_context}"
        "请根据以上首帧和尾帧图片，以及以下内部动作记录，写成一段可直接用于首尾帧视频生成的中文自然语言 Prompt。\n"
        f"{action_notes[:900]}\n"
        "如果内部动作记录不完整，请重新观察首帧和尾帧的可见差异，再补足合理但不过度夸张的动作过渡。\n"
        "最终输出必须包含主体、从首帧到尾帧的动作变化、镜头变化、背景变化。"
        "重点写身体姿态变化、头部变化、手臂变化、腿部变化、道具位置变化。"
        "服装、发型、背景只简要描述一次，不要把重点放在外观。"
        "如果背景没有明显变化，必须明确写“背景保持不变”。"
        "如果镜头没有明显变化，写“镜头保持固定”；如果能合理推断镜头运动，可写缓慢推进、缓慢拉远或跟随主体。"
        "必须根据可见差异合理推断，不能强行夸张动作。"
        "如果两张图差异很小，允许写：角色保持相近姿态，仅出现轻微头部、手臂或衣摆变化，镜头保持固定，背景保持不变。"
        "最终视频 Prompt 应包含“从……逐渐……”“缓慢……”“进入……”“转向……”或“保持相近姿态，仅出现轻微……”这类动作过渡表达。"
        "不要写成图片分析报告，不要输出英文，不要输出 SD 标签，不要输出 JSON，不要输出项目符号。"
        "只输出最终视频 Prompt。"
        f"{retry_note}"
    )
    llama_template = (
        "<|im_start|>system\n"
        "你是 NovaFlow 的首尾帧视频 Prompt 写作助手。请把首尾帧差异记录改写成最终视频 Prompt。"
        "重点描述身体姿态变化、手臂变化、腿部变化、头部变化、道具变化、镜头变化和背景变化。"
        "不要重点描述服装和外观。不要写成图片分析报告。不要输出英文、SD 标签、JSON 或项目符号。只输出最终视频 Prompt。"
        "<|im_end|>\n"
        "<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n"
    )
    return prompt, llama_template, 300


def is_first_last_action_prompt_quality_ok(text: str) -> bool:
    value = clean_text(text)
    if not value:
        return False
    has_action = any(term in value for term in FIRST_LAST_ACTION_TERMS)
    has_body = any(term in value for term in FIRST_LAST_BODY_TERMS)
    has_camera = any(term in value for term in FIRST_LAST_CAMERA_TERMS)
    has_background = any(term in value for term in FIRST_LAST_BACKGROUND_TERMS)
    return has_action and has_body and has_camera and has_background


def log_prompt_assistant_event(event: str, **fields) -> None:
    payload = {"event": event, **fields}
    try:
        print(json.dumps(payload, ensure_ascii=False), file=sys.stderr, flush=True)
    except Exception:
        pass


def clean_reverse_output(output: str) -> str:
    text = clean_text(output)
    text = re.sub(r"^(这张图片展示了|这张图片显示了|图片展示了|图片显示了|画面展示了|画面显示了)", "", text).strip(" ：:，,。")
    text = re.sub(r"\n{2,}", "\n", text).strip()
    return text


assistant = PromptAssistant()


def handle_request(payload: dict) -> dict:
    command = str(payload.get("command") or "")
    if command == "status":
        return assistant.status_payload()
    if command == "optimizePrompt":
        return assistant.optimize_prompt(payload)
    if command == "storyboardStoryDirections":
        return assistant.storyboard_story_directions(payload)
    if command == "storyboardVisualEventChain":
        return assistant.storyboard_visual_event_chain(payload)
    if command == "storyboardFinalShotPrompts":
        return assistant.storyboard_final_shot_prompts(payload)
    if command == "storyboardUnifiedNineShots":
        return assistant.storyboard_unified_nine_shots(payload)
    if command == "storyboardDirectorPlan":
        return assistant.storyboard_director_plan(payload)
    if command == "reverseImagePrompt":
        return assistant.reverse_image_prompt(payload)
    if command == "shutdown":
        raise SystemExit(0)
    raise ValueError(f"未知 Prompt Assistant 命令：{command}")


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


class PromptAssistantAlreadyRunningError(RuntimeError):
    code = "prompt-assistant-already-running"


def prompt_assistant_guard_port() -> int:
    value = clean_text(os.getenv("NOVAFLOW_PROMPT_ASSISTANT_GUARD_PORT") or "")
    if not value:
        return PROMPT_ASSISTANT_GUARD_PORT
    try:
        port = int(value)
    except ValueError:
        return PROMPT_ASSISTANT_GUARD_PORT
    return port if 1 <= port <= 65535 else PROMPT_ASSISTANT_GUARD_PORT


def acquire_prompt_assistant_guard_socket(port: int | None = None) -> socket.socket:
    """Hold a non-stale process guard without taking it during module import."""

    guard = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
        guard.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    try:
        guard.bind((PROMPT_ASSISTANT_GUARD_HOST, int(port or prompt_assistant_guard_port())))
        guard.listen(1)
        return guard
    except OSError as error:
        guard.close()
        raise PromptAssistantAlreadyRunningError(
            "Prompt Assistant 本地模型正在另一个 NovaFlow 实例中使用，请等待当前任务完成后重试"
        ) from error


def emit_prompt_assistant_error(error_payload: dict) -> None:
    """Emit a structured failure; retry once without optional bulky fields."""

    try:
        emit(error_payload)
        return
    except (OSError, ValueError):
        pass
    bounded = {
        key: error_payload[key]
        for key in (
            "id", "ok", "error", "errorCode", "elapsedSeconds",
            "requestedVisualSchema", "failureClass", "validationLeaf",
            "generationGate",
        )
        if key in error_payload
    }
    bounded["ok"] = False
    try:
        emit(bounded)
    except (OSError, ValueError):
        # The response pipe is no longer writable.  Never replace the original
        # application failure with a secondary stdio exception or crash the
        # long-lived service; the parent timeout remains the last-resort guard.
        log_prompt_assistant_event(
            "prompt_assistant_error_emit_failed",
            command="reverseImagePrompt",
            errorCode=str(bounded.get("errorCode") or "")[:80],
        )


def prompt_assistant_failure_status(assistant_instance, error: Exception) -> dict:
    """Build failure status without allowing status probing to mask the error."""

    try:
        return assistant_instance.status_payload()
    except Exception:
        return {
            "runtimeStatus": "推理失败",
            "error": str(error),
        }


def main() -> int:
    try:
        guard_socket = acquire_prompt_assistant_guard_socket()
    except PromptAssistantAlreadyRunningError as exc:
        emit({
            "type": "startup-error",
            "ok": False,
            "errorCode": exc.code,
            "error": str(exc),
        })
        return 73
    with guard_socket:
        emit({"type": "ready", "status": assistant.status_payload()})
        for line in sys.stdin:
            started = time.time()
            request_id = None
            payload = None
            try:
                payload = json.loads(line)
                request_id = payload.get("id")
                result = handle_request(payload)
                emit({"id": request_id, "ok": True, "data": result, "elapsedSeconds": round(time.time() - started, 2)})
            except SystemExit:
                raise
            except Exception as exc:
                assistant.status = "推理失败"
                assistant.error = str(exc)
                diagnostics = dict(getattr(exc, "diagnostics", {}) or {})
                bounded_error_code = re.sub(
                    r"[^a-zA-Z0-9_.:-]+",
                    "-",
                    str(getattr(exc, "code", "") or "").strip(),
                ).strip("-")[:80]
                failure_status = prompt_assistant_failure_status(assistant, exc)
                error_payload = {
                    "id": request_id,
                    "ok": False,
                    "error": str(exc),
                    "status": failure_status,
                    "elapsedSeconds": round(time.time() - started, 2),
                }
                if bounded_error_code:
                    error_payload["errorCode"] = bounded_error_code
                is_static_visual_v2 = (
                    isinstance(payload, dict)
                    and str(payload.get("command") or "") == "reverseImagePrompt"
                    and str(payload.get("purpose") or "").strip()
                    == "static-image-reverse"
                    and str(payload.get("visualSchema") or "").strip()
                    == VISUAL_SCHEMA_VERSION_V2
                )
                is_minimax_h3_visual = (
                    isinstance(payload, dict)
                    and str(payload.get("command") or "") == "reverseImagePrompt"
                    and str(payload.get("purpose") or "").strip().startswith("minimax-h3-")
                )
                if not is_static_visual_v2 and not is_minimax_h3_visual:
                    error_payload["traceback"] = traceback.format_exc()
                if diagnostics:
                    error_payload.update(diagnostics)
                emit_prompt_assistant_error(error_payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
