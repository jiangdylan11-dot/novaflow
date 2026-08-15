from __future__ import annotations

import json
import math
import re
import unicodedata
from typing import Any


SCHEMA_VERSION_V1 = "nf.visual.v1"
SCHEMA_VERSION_V2 = "nf.visual.v2"
SCHEMA_VERSION = SCHEMA_VERSION_V1
TOP_LEVEL_KEYS_V1 = (
    "schema",
    "asset_type",
    "entities",
    "relations",
    "scene",
    "look",
    "camera_cues",
    "ocr",
    "uncertain",
)
TOP_LEVEL_KEYS_V2 = (*TOP_LEVEL_KEYS_V1, "content_safety")
ENTITY_KEYS = ("name", "count", "appearance", "pose", "action", "materials", "colors")
SCENE_KEYS = ("environment", "background", "spatial_layers")
LOOK_KEYS = ("lighting", "palette", "materials", "style", "atmosphere", "finish")
CAMERA_KEYS = ("shot", "angle", "composition", "depth_of_field")
CONTENT_SAFETY_KEYS = (
    "level",
    "body_exposure",
    "interaction_category",
    "age_assessment",
    "visible_person_count",
    "signals",
    "sensitive_visible_facts",
)
LOCAL_COMPACT_LEGACY_KEYS = (
    "asset",
    "level",
    "body",
    "interaction",
    "age",
    "people",
    "subject",
    "appearance",
    "pose",
    "action",
    "relations",
    "materials",
    "colors",
    "scene",
    "lighting",
    "style",
    "camera",
    "signals",
    "facts",
)
LOCAL_COMPACT_KEYS = (
    "asset",
    "level",
    "body",
    "interaction",
    "age",
    "people",
    "entities",
    "relations",
    "scene",
    "look",
    "camera",
    "signals",
    "facts",
)
LOCAL_COMPACT_ENTITY_KEYS = (
    "kind",
    "name",
    "appearance",
    "pose",
    "action",
    "materials",
    "colors",
)
LOCAL_COMPACT_ENTITY_KINDS = {"person", "partial_person", "object"}
LOCAL_STATIC_COMPACT_ROOT_KEYS = ("n2",)
LOCAL_STATIC_COMPACT_FIELD_COUNT = 13
LOCAL_STATIC_COMPACT_ENTITY_FIELD_COUNT = 7
LOCAL_STATIC_COMPACT_LEVEL_CODES = {
    0: "safe",
    1: "suggestive",
    2: "nudity",
    3: "explicit",
    4: "uncertain",
}
LOCAL_STATIC_COMPACT_BODY_CODES = {
    0: "none",
    1: "partial",
    2: "full",
    3: "uncertain",
}
LOCAL_STATIC_COMPACT_INTERACTION_CODES = {
    0: "none",
    1: "intimate",
    2: "sexual",
    3: "uncertain",
}
LOCAL_STATIC_COMPACT_AGE_CODES = {
    0: "adult_appearing",
    1: "age_unverifiable",
    2: "young_or_minor_indicators",
    3: "not_applicable",
    4: "uncertain",
}
LOCAL_STATIC_COMPACT_ENTITY_KIND_CODES = {
    0: "person",
    1: "partial_person",
    2: "object",
}
LOCAL_STATIC_COMPACT_SIGNAL_CODES = {
    "n": "nudity",
    "p": "sexualized_pose",
    "x": "explicit_activity",
    "a": "explicit_anatomy",
    "f": "sexual_fluid",
    "u": "age_ambiguous",
}
CONTENT_LEVELS = {"safe", "suggestive", "nudity", "explicit", "uncertain"}
BODY_EXPOSURES = {"none", "partial", "full", "uncertain"}
INTERACTION_CATEGORIES = {"none", "intimate", "sexual", "uncertain"}
AGE_ASSESSMENTS = {
    "adult_appearing",
    "age_unverifiable",
    "young_or_minor_indicators",
    # Legacy nf.visual.v2 read compatibility only. New model output must not use it.
    "ambiguous_or_young_appearing",
    "not_applicable",
}
AGE_ASSESSMENTS_REQUIRING_AMBIGUOUS_SIGNAL = {
    "age_unverifiable",
    "young_or_minor_indicators",
    "ambiguous_or_young_appearing",
}
SENSITIVE_CANDIDATE_AGE_ASSESSMENTS = {"adult_appearing", "age_unverifiable"}
CONTENT_SIGNALS = {
    "nudity",
    "sexualized_pose",
    "explicit_activity",
    "explicit_anatomy",
    "sexual_fluid",
    "age_ambiguous",
}
EXPLICIT_SIGNALS = {"explicit_activity", "explicit_anatomy", "sexual_fluid"}
SAFE_PROJECTION_LOOK_KEYS = ("lighting", "palette", "style", "atmosphere", "finish")
SAFE_PROJECTION_ENTITY_KEYS = ("name", "count", "appearance", "colors")
YOUNG_AGE_PATTERN = re.compile(
    r"(?:少女|少年|女孩|男孩|幼女|萝莉|正太|未成年人?|儿童|孩童|小孩|婴儿)"
    r"|(?<![a-z0-9_])(?:loli|shota|child(?:ren)?|teens?|teenagers?|girls?|boys?|minors?|underage)(?![a-z0-9_])",
    flags=re.I,
)
LOCAL_SINGLE_IMAGE_AMBIGUOUS_AGE_NOUN_PATTERN = re.compile(
    r"(?:少女|少年|女孩|男孩|年轻(?:女性|男性|女人|男人|人物|角色)?)"
    r"|(?<![a-z0-9_])(?:(?:young|youthful)\s+(?:wom[ae]n|m[ae]n|persons?|characters?|figures?)|"
    r"girls?|boys?)(?![a-z0-9_])",
    flags=re.I,
)
LOCAL_SINGLE_IMAGE_TRUSTED_NON_PERSON_CORE_PATTERN = (
    r"(?:"
    r"(?:(?:AI|3D|动漫|卡通|二次元|复古|塑料|木质|金属|毛绒|布艺|可爱|"
    r"粉色|红色|蓝色|绿色|黄色|白色|黑色|大型|小型))*"
    r"(?:小女孩|小男孩|女孩|男孩|少女|少年|儿童|女童|男童|幼女|幼童|婴儿)"
    r"(?:(?:造型|形象|图案|印花|雕刻|款式|主题)(?:的)?)?"
    r"(?:(?:毛绒|布艺|塑料|木质|金属))?"
    r"(?:玩偶|娃娃|手办|雕像|海报|标牌|包装|玩具|校徽|杂志|书籍|封面|模型)"
    r"|game\s+boy"
    r"|(?:(?:anime|cartoon|vintage|plastic|wooden|metal|plush|cloth|cute|pink|red|"
    r"blue|green|yellow|white|black|large|small)\s+)*"
    r"(?:(?:baby|newborn|little|young|teen|teenage|teenaged|school[-\s]?age[dr]?)\s+)?"
    r"(?:(?:girls?|boys?|child(?:ren)?|characters?)\s+)?"
    r"(?:(?:design|depiction|print|pattern|carving|themed?)\s+)?"
    r"(?:(?:plush|cloth|plastic|wooden|metal)\s+)?"
    r"(?:dolls?|figurines?|statues?|posters?|signs?|packaging|toys?|badges?|"
    r"magazines?|books?|covers?)(?:\s+displays?)?"
    r")"
)
LOCAL_SINGLE_IMAGE_TRUSTED_NON_PERSON_NAME_PATTERN = re.compile(
    rf"^{LOCAL_SINGLE_IMAGE_TRUSTED_NON_PERSON_CORE_PATTERN}$",
    flags=re.I,
)
LOCAL_SINGLE_IMAGE_NON_PERSON_REFERENCE_SUFFIX_PATTERN = (
    r"(?=$|[ \t]*[,.;:!?，。；：！？)\]}\"'”’]"
    r"|[ \t]+(?:in|on|at|by|near|beside|behind|inside|outside|under|over|"
    r"against|from|with|without|of|for|while|where|located|placed|displayed)\b"
    r"|[ \t]*(?:位于|放在|置于|摆在|陈列在|展示在|坐落在))"
)
LOCAL_SINGLE_IMAGE_TRUSTED_NON_PERSON_REFERENCE_PATTERN = re.compile(
    rf"(?<![a-z0-9_]){LOCAL_SINGLE_IMAGE_TRUSTED_NON_PERSON_CORE_PATTERN}"
    rf"(?![a-z0-9_]){LOCAL_SINGLE_IMAGE_NON_PERSON_REFERENCE_SUFFIX_PATTERN}",
    flags=re.I,
)
LOCAL_SINGLE_IMAGE_NON_AGE_COMPOUND_PATTERN = re.compile(
    r"(?:婴儿蓝)"
    r"|(?<![a-z0-9_])baby[-\s]+(?:blue|pink|oil)(?![a-z0-9_])"
    r"|(?<![a-z0-9_])minor[-\s]+(?:characters?|scars?|scratches?|details?|changes?|issues?|damage)(?![a-z0-9_])",
    flags=re.I,
)
LOCAL_SINGLE_IMAGE_AGE_MODIFIED_NON_PERSON_PATTERN = re.compile(
    rf"(?:"
    r"(?<![a-z0-9_])(?:[0-9]{1,3}(?:[.,][0-9]+)?|"
    r"zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
    r"thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|"
    r"forty|fifty|sixty|seventy|eighty|ninety)"
    r"[-\s]+(?:years?|yrs?)[-\s]+old[-\s]+"
    r"(?:(?:whiskey|wine|glass|plastic|wooden|metal|stone|brick|office|apartment|historic)"
    r"[-\s]+)?(?:bottles?|buildings?|houses?|cars?|vehicles?|trees?|books?|posters?|"
    r"dolls?|toys?|products?|objects?|items?|artifacts?)(?![a-z0-9_])"
    r"|(?<![0-9])(?:[0-9]{1,3}|[零〇一二三四五六七八九十百两]{1,6})\s*(?:周岁|岁)"
    r"(?:的)?(?:(?:威士忌|葡萄酒|玻璃|塑料|木质|金属|石质|砖石|办公|公寓|历史)的?)?"
    r"(?:瓶子?|建筑|房屋|汽车|车辆|树木?|书籍?|海报|玩偶|玩具|产品|物体|物品|文物)"
    rf"){LOCAL_SINGLE_IMAGE_NON_PERSON_REFERENCE_SUFFIX_PATTERN}",
    flags=re.I,
)
LOCAL_SINGLE_IMAGE_LIVING_PERSON_EVIDENCE_PATTERN = re.compile(
    r"(?:真人|真实人类|活人|活体|会呼吸|人体皮肤|人物皮肤|而非玩具|不是玩具)"
    r"|(?<![a-z0-9_])(?:real\s+human|living\s+person|breathing\s+(?:person|body)|"
    r"human\s+skin|not\s+a\s+(?:doll|toy))(?![a-z0-9_])",
    flags=re.I,
)
SAFE_SENSITIVE_PATTERN = re.compile(
    r"(?:裸体|裸露|全裸|半裸|一丝不挂|性行为|性交|交合|性爱|性活动|口交|肛交|自慰|手淫|"
    r"生殖器|性器官|阴茎|阳具|龟头|阴道|外阴|阴唇|阴蒂|阴部|肛门|乳头|乳房|裸身|赤裸身体|精液|性体液|私处|下体|色情|情色|成人内容|"
    r"性暗示|性感姿势|挑逗姿势|胸部暴露|胸部完全可见|插入(?:阴道|肛门|性器官))"
    r"|(?<![a-z0-9_])(?:nudity|(?:fully|partially)\s+nude|nude\s+(?:person|woman|man|body|figure|character|portrait)|"
    r"naked\s+(?:person|woman|man|body|figure|character)|topless|nsfw|porn(?:ographic|ography)?|"
    r"sexual[_\s-]+(?:activity|act|fluid)|sexualized[_\s-]+pose|suggestive[_\s-]+pose|"
    r"explicit[_\s-]+(?:activity|anatomy)|intercourse|"
    r"oral\s+sex|anal\s+sex|masturbat(?:e|ion|ing)|genitals?|penis|vagina|vulva|anus|semen|"
    r"bare\s+breasts?|exposed\s+breasts?|visible\s+breasts?|breasts?\s+(?:fully\s+)?(?:visible|exposed))(?![a-z0-9_])",
    flags=re.I,
)
SAFE_PROJECTION_POSE_PATTERN = re.compile(
    r"(?:自然站立|站立|站姿|站着|坐姿|坐着|端坐|平躺|仰卧|俯卧|侧躺|躺卧)"
    r"|(?<![a-z0-9_])(?:standing(?:\s+pose)?|seated(?:\s+pose)?|sitting(?:\s+pose)?|"
    r"lying(?:\s+down|\s+pose)?|supine|prone|side[-\s]lying)(?![a-z0-9_])",
    flags=re.I,
)
INTERACTION_PARTICIPANT_OR_BODY_PATTERN = (
    r"(?:人物|角色|成人|女性|男性|一方|双方|彼此|对方|自身|另一(?:名|位)?(?:人物|角色)|"
    r"手(?:部|指)?|口部|嘴|舌(?:头)?|身体|躯干|胸部|乳房|臀部|双?腿|性器官|生殖器|阴茎|阳具|龟头|阴道|外阴|阴唇|阴蒂|肛门|下体|私处|身体部位|"
    r"(?<![a-z0-9_])(?:persons?|characters?|adults?|women|men|participants?|partners?|each other|the other|self|"
    r"own body|hands?|fingers?|mouth|tongue|body|torso|breasts?|hips?|legs?|genitals?|penis|vagina|vulva|anus|"
    r"body parts?)(?![a-z0-9_]))"
)
INTERACTION_RELATION_CONNECTOR_PATTERN = (
    r"(?:与|和|同|接触|碰触|贴合|贴着|抵住|顶住|压住|压在|交叠|重叠|进入|伸入|放入|插入|贯入|包裹|套住|握住|抓住|含住|骑在|骑乘|跨坐|"
    r"(?<![a-z0-9_])(?:with|against|"
    r"touch(?:es|ed|ing)?|contact(?:s|ed|ing)?|press(?:es|ed|ing)? against|overlap(?:s|ped|ping)?|"
    r"penetrat(?:es|ed|ing)?|insert(?:s|ed|ing)?|enter(?:s|ed|ing)?|inside|wrap(?:s|ped|ping)?|"
    r"envelop(?:s|ed|ing)?|grip(?:s|ped|ping)?|hold(?:s|held|ing)?|ride(?:s|rode|riding)?|straddl(?:es|ed|ing)?)(?![a-z0-9_]))"
)
INTERACTION_RELATION_EVIDENCE_PATTERN = re.compile(
    rf"{INTERACTION_PARTICIPANT_OR_BODY_PATTERN}.{{0,32}}"
    rf"{INTERACTION_RELATION_CONNECTOR_PATTERN}.{{0,32}}"
    rf"{INTERACTION_PARTICIPANT_OR_BODY_PATTERN}",
    flags=re.I,
)
INTERACTION_ACTION_EVIDENCE_PATTERN = re.compile(
    r"(?:直接接触|保持接触|持续接触|相互接触|碰触|贴合|贴着|抵住|顶住|压住|交叠|重叠|进入|伸入|放入|插入|贯入|"
    r"抽动|抽送|抽插|往复(?:移动|摩擦|动作)|摩擦|揉捏|抚摸|抚弄|爱抚|抓握|握住|抓住|按压|推动|拉动|"
    r"舔舐|舔弄|含住|吸吮|包裹|套住|骑乘|跨坐)"
    r"|(?<![a-z0-9_])(?:direct contact|maintain(?:s|ed|ing)? contact|remain(?:s|ed|ing)? in contact|"
    r"touch(?:es|ed|ing)?|press(?:es|ed|ing)? against|overlap(?:s|ped|ping)?|penetrat(?:es|ed|ing)?|"
    r"insert(?:s|ed|ing)?|thrust(?:s|ed|ing)?|mov(?:es|ed|ing) back and forth|rub(?:s|bed|bing)?|"
    r"strok(?:es|ed|ing)?|grip(?:s|ped|ping)?|grasp(?:s|ed|ing)?|hold(?:s|ing)?|held|squeez(?:es|ed|ing)?|"
    r"press(?:es|ed|ing)?|wrap(?:s|ped|ping)?|envelop(?:s|ed|ing)?|ride(?:s|rode|riding)?|straddl(?:es|ed|ing)?|"
    r"fondl(?:es|ed|ing)?|caress(?:es|ed|ing)?|lick(?:s|ed|ing)?|suck(?:s|ed|ing)?)(?![a-z0-9_])",
    flags=re.I,
)
SENSITIVE_TARGET_ACTION_EVIDENCE_PATTERN = re.compile(
    r"(?:手扶|扶住|触摸|握持|抓持|接触|按压|包覆)"
    r"[^\n，。；：、,.;:!?！？]{0,12}"
    r"(?:性器官|生殖器|阴茎|阳具|龟头|阴道|外阴|阴唇|阴蒂|肛门)"
    r"|(?:性器官|生殖器|阴茎|阳具|龟头|阴道|外阴|阴唇|阴蒂|肛门)"
    r"[^\n，。；：、,.;:!?！？]{0,12}"
    r"(?:手扶|扶住|触摸|握持|抓持|接触|按压|包覆)",
    flags=re.I,
)


def _has_concrete_interaction_action(value: Any) -> bool:
    text = _normalize_scan_text(value)
    return bool(
        INTERACTION_ACTION_EVIDENCE_PATTERN.search(text)
        or SENSITIVE_TARGET_ACTION_EVIDENCE_PATTERN.search(text)
    )


NON_VISIBLE_EVIDENCE_PATTERN = re.compile(
    r"(?:无法|不能|未能|难以|不|并非).{0,8}(?:直接|清晰|明显)?可见"
    r"|(?<![a-z0-9_])(?:not|cannot|can't|unable to).{0,16}(?:directly|clearly|visibly)?\s*visible(?![a-z0-9_])",
    flags=re.I,
)
DEGRADED_NON_NEUTRAL_PATTERN = re.compile(
    r"(?:胸部|胸口|乳房|乳头|臀部|臀|胯部|胯下|大腿根|双腿分开|张开双腿|腿部张开|湿润|潮红|体液|"
    r"性器官|生殖器|阴茎|阳具|龟头|阴道|外阴|阴唇|阴蒂|肛门|下体|私处)"
    r"|(?<![a-z0-9_])(?:breasts?|nipples?|cleavage|buttocks?|crotch|groin|inner thighs?|"
    r"legs? (?:spread|apart)|spread legs?|genitals?|penis|vagina|vulva|anus|wet(?:ness)?|sexual fluid|"
    r"naked|erotic|intimate|sensual|seductive|sexually suggestive)(?![a-z0-9_])",
    flags=re.I,
)
PERSON_ASSET_TYPE_PATTERN = re.compile(
    r"^(?:人物|角色|人像|肖像|角色立绘|人物插画|persons?|characters?|portrait)$",
    flags=re.I,
)
VISIBLE_PERSON_PATTERN = re.compile(
    r"(?:人物|女人|男人|女子|男子|女郎|女士|男士|绅士|姑娘|女孩|男孩|少女|少年|人类|人体|人像|"
    r"女性(?:人物|角色|人体|人像)|男性(?:人物|角色|人体|人像)|"
    r"(?:一|两|二|三|多|\d+)名(?:女性|男性)?角色)"
    r"|(?<![a-z0-9_])(?:persons?|people|wom[ae]n|m[ae]n|lad(?:y|ies)|gentle(?:man|men)|girls?|boys?|humans?|"
    r"female\s+(?:person|character|figure|body)|male\s+(?:person|character|figure|body))(?![a-z0-9_])"
    r"|(?<![\u4e00-\u9fff])(?:她|他)(?=$|的|正在|位于|坐|站|躺|穿|裸)",
    flags=re.I,
)
ZERO_PERSON_GENDER_SUBJECT_PATTERN = re.compile(
    r"(?:成年)?(?:女性|男性)(?:$|人物|角色|人体|人像|身体|主体|全裸|裸体|裸露|姿态|动作)"
    r"|(?:全裸|裸体|裸露)(?:的)?(?:成年)?(?:女性|男性)"
    r"|(?<![a-z0-9_])adult\s+(?:female|male)(?!\s+(?:product|item|goods|clothing|underwear|toy|label)\b)"
    r"|(?<![a-z0-9_])adult\s+(?:characters?|figures?|bod(?:y|ies)|subjects?)(?![a-z0-9_])"
    r"|(?<![a-z0-9_])(?:female|male)\s+(?:person|subject|character|figure|body|nude|naked)(?![a-z0-9_])",
    flags=re.I,
)
ZERO_PERSON_FORBIDDEN_SIGNALS = {
    "nudity",
    "sexualized_pose",
    "explicit_activity",
    "age_ambiguous",
}
ZERO_PERSON_OBJECT_PATTERN = re.compile(
    r"(?:道具|物件|物体|产品|商品|用品|静物|器具|玩具|模型|雕塑|装置|包装|服装|衣物|内衣|配饰|底座|容器|部件|配件)"
    r"|(?<![a-z0-9_])(?:objects?|props?|products?|items?|goods|still\s+life|toys?|models?|sculptures?|devices?|packages?|clothing|underwear|accessories?)(?![a-z0-9_])",
    flags=re.I,
)
ZERO_PERSON_HUMAN_COUNT_PATTERN = re.compile(
    r"(?:名|位)"
    r"|(?<![a-z0-9_])(?:\d+|one|two|three|several|multiple)\s+(?:persons?|people|wom[ae]n|m[ae]n|girls?|boys?|humans?)(?![a-z0-9_])",
    flags=re.I,
)

_MAX_ENTITIES = 12
LOCAL_SALIENT_INVENTORY_KEYS = (
    "partial_people",
    "objects",
    "effects",
)
LOCAL_SALIENT_INVENTORY_PROTOCOL = (
    ("PARTIAL_PEOPLE", "partial_people", 3),
    ("OBJECTS", "objects", 4),
    ("EFFECTS", "effects", 4),
)
LOCAL_SALIENT_INVENTORY_ITEM_KEYS = (
    "name",
    "appearance",
    "relation",
)
LOCAL_SALIENT_INVENTORY_MAX_CHARS = 1200
LOCAL_SALIENT_INVENTORY_MAX_LINE_CHARS = 480
LOCAL_SALIENT_INVENTORY_FIELD_LIMITS = (40, 100, 120)
LOCAL_SALIENT_INVENTORY_CJK_PATTERN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
LOCAL_SALIENT_INVENTORY_FORBIDDEN_FIELD_CHAR_PATTERN = re.compile(
    r'''[A-Za-z_`{}\[\]<>\\"=|;]'''
)
LOCAL_SALIENT_INVENTORY_FORBIDDEN_TEXT_PATTERN = re.compile(
    r"(?:系统|开发者|用户|助手|模型).{0,8}(?:提示|消息|指令|规则)"
    r"|(?:忽略|无视|覆盖|绕过|替换|改写).{0,12}(?:以上|此前|系统|开发者|指令|规则|提示)"
    r"|(?:请|必须|务必|应当|需要|立即|现在).{0,20}(?:执行|遵循|忽略|输出|返回|修改|写入|生成|回答)"
    r"|(?:执行|遵循).{0,12}(?:命令|指令|要求|规则)"
    r"|(?:删除|移除|去掉|取消|替换|改成|变成|生成|创建|新增|添加|改写).{0,12}"
    r"(?:主角|主体|人物|角色|画面|内容|物体|物品|道具|武器|怪物)"
    r"|(?:主角|主体|人物|角色|画面|内容).{0,12}"
    r"(?:删除|移除|去掉|取消|替换|改成|变成|生成|创建|新增|添加|改写)"
    r"|(?:输出|返回|回答|生成).{0,12}(?:json|markdown|代码|提示词|合同)"
    r"|(?<![a-z0-9_])(?:system|developer|assistant|user|prompt|instruction|role)(?![a-z0-9_])"
    r"|```|<\|",
    flags=re.I,
)
LOCAL_SALIENT_PARTIAL_PERSON_PATTERN = re.compile(
    r"(?:人物|行人|路人|游客|人影|人形|角色|参与者|女性|男性|女子|男子|女人|男人|成人)"
)
LOCAL_SALIENT_PARTIAL_BODY_NAME_PATTERN = re.compile(
    r"^(?:(?:边缘|画外|局部|部分|裁切|截断|露出|可见|远处|背景|后景|远景)(?:的)?)?"
    r"(?:背影|身影|脸|面孔|头部|手臂|手掌|手|肩膀|胳膊|"
    r"腿部|大腿|小腿|腿|脚部|脚|躯干|身体)$"
)
LOCAL_SALIENT_PARTIAL_CONTEXT_PATTERN = re.compile(
    r"(?:边缘|背景|远处|远景|后景|后方|角落|画外|裁切|截断|局部|部分可见|仅.{0,6}可见|遮挡|模糊)"
)
LOCAL_SALIENT_MULTI_PERSON_PATTERN = re.compile(
    r"(?:[二两三四五六七八九十\d]+(?:名|位|个|道)?"
    r"(?:人物|行人|路人|游客|人|人影|身影|成人)|"
    r"(?:多|几|数|若干)(?:名|位|个|道)?"
    r"(?:人物|行人|路人|游客|人|人影|身影|成人)|"
    r"(?:一对|一双|成对)(?:的)?(?:人物|行人|路人|游客|人|人影|身影|男女)?|"
    r"一群人|人群|众人|双人|"
    r"[二两三四五六七八九十\d]+(?:只|条|张)?"
    r"(?:脸|面孔|头部|手臂|手掌|手|肩膀|胳膊|腿部|大腿|小腿|腿|脚部|脚|躯干)|"
    r"双(?:手|臂|腿|脚))"
)
LOCAL_SALIENT_NONHUMAN_PERSON_PATTERN = re.compile(
    r"(?:机器人|机械人|人形机器|机械(?:手臂|臂|手|腿)|假肢|义肢|"
    r"雕像|雕塑|玩偶|人偶|手办|模型|海报|照片|画像|壁画|屏幕人物)"
)
LOCAL_SALIENT_FOREIGN_PARTICIPANT_PATTERN = re.compile(
    r"(?:(?:另一|其他|第二|第三)(?:名|位|个)?(?:人物|角色|参与者|人|男子|女子|男人|女人|男性|女性))"
    r"|(?:人物|角色|参与者|男子|女子|男人|女人|男性|女性|行人|路人|游客|"
    r"人影|身影|背影|人群|众人|陌生人|老人|老者|老年人|"
    r"成年人|成人|人类)"
)
LOCAL_SALIENT_FOREIGN_BODY_PART_PATTERN = re.compile(
    r"(?:另一|其他|第二|额外|画外|画面边缘|边缘|背景)(?:的)?"
    r"(?:一)?(?:只|条|张)?(?:脸|面孔|头部|手臂|手掌|手|肩膀|胳膊|"
    r"腿部|大腿|小腿|腿|脚部|脚|躯干|身体)"
)
LOCAL_SALIENT_BODY_PART_PATTERN = re.compile(
    r"(?:(?:一只|一条|一张|半张|单独的?|独立的?|露出的?|可见的?|"
    r"画面边缘的?|边缘的?)(?:脸|面孔|头部|手臂|手掌|手|肩膀|胳膊|"
    r"腿部|大腿|小腿|腿|脚部|脚|躯干|身体)|"
    r"(?:手臂|手掌|肩膀|胳膊|腿部|大腿|小腿|脚部|躯干|身体)"
    r"(?:进入|伸入|露出|可见|出现))"
)
LOCAL_SALIENT_MAIN_BODY_PART_ANCHOR_PATTERN = re.compile(
    r"(?:(?:主角|主体).{0,8}(?:脸|面孔|头部|头|手臂|手掌|手|肩膀|肩|"
    r"胳膊|臂|腿部|大腿|小腿|腿|脚部|脚|躯干|身体)|"
    r"(?:脸|面孔|头部|头|手臂|手掌|手|肩膀|肩|胳膊|臂|"
    r"腿部|大腿|小腿|腿|脚部|脚|躯干|身体).{0,8}(?:主角|主体))"
)
LOCAL_SALIENT_GENERIC_OBJECT_PATTERN = re.compile(
    r"^(?:(?:一个|某个|未知|显著|大型|小型)(?:的)?)?"
    r"(?:物体|物品|物件|东西|道具|武器|装备|装饰)$"
)
LOCAL_SALIENT_POSITION_RELATION_PATTERN = re.compile(
    r"(?:位于|处于|靠近|贴近|接触|贴合|环绕|悬浮|悬挂|放置|固定|"
    r"持于|手持|握持|抓住|背负|佩戴|系于|装在|"
    r"左(?:侧|边|手)?|右(?:侧|边|手)?|上方|下方|前方|后方|身后|肩后|"
    r"腰间|脚边|手中|画面中央|画面中心|画面边缘)"
)
LOCAL_SALIENT_EFFECT_PATTERN = re.compile(
    r"(?:能量|火焰|火光|光环|光效|特效|发光|辉光|光芒|光带|光束|光翼|"
    r"电弧|闪电|雷电|粒子效果|魔法阵)"
)
RICH_VISUAL_SECTIONS = (
    "[风格设定]",
    "[主体物品]",
    "[环境背景]",
    "[光线与色彩]",
    "[拍摄参数]",
)
RICH_VISUAL_MIN_CHARS = 300
RICH_VISUAL_SYSTEM_TEXT = (
    "你是 NovaFlow 的像素级反推生图提示词编辑器，只输出最终中文TOML分区内容。"
)
RICH_SENSITIVE_YOUNG_PATTERN = re.compile(
    rf"(?:{YOUNG_AGE_PATTERN.pattern})|(?:年轻|幼态|娃娃脸|青少年|青春期)"
    r"|(?<![a-z0-9_])(?:young|youth(?:ful)?|juvenile)(?![a-z0-9_])",
    flags=re.I,
)
REQUIREMENTS_EXPLICIT_MINOR_PATTERN = re.compile(
    r"(?:未成年人?|未满\s*(?:18|十八)\s*岁?|(?:18|十八)\s*岁?\s*(?:以下|以内)|"
    r"(?<![0-9])(?:1[0-7]|[0-9])\s*岁(?![0-9])|青少年|儿童|孩童|小孩|幼女|幼童|幼儿|婴幼儿?|婴儿|萝莉|正太)"
    r"|(?<![a-z0-9_])(?:underage|minors?|child(?:ren)?|teens?|teenagers?|loli|shota|under\s*18|"
    r"(?:1[0-7]|[0-9])[-\s]*years?[-\s]*old|(?:1[0-7]|[0-9])\s*y\s*/?\s*o|aged?\s*(?:1[0-7]|[0-9]))(?![a-z0-9_])",
    flags=re.I,
)
LOCAL_SINGLE_IMAGE_EXPLICIT_MINOR_EVIDENCE_PATTERN = re.compile(
    r"(?:未成年人?|青少年|儿童|孩童|孩子|小朋友|小孩|幼女|幼童|幼儿|婴幼儿?|婴儿|婴孩|新生儿|学童|萝莉|正太)"
    r"|(?<![娇纤矮])小\s*(?:女孩|男孩)"
    r"|(?:女童|男童|"
    r"(?:幼年|年幼|幼小|年少)(?:的)?(?:女孩|男孩|少女|少年|人物|角色|女性|男性)|"
    r"小学(?:生|学生|女孩|男孩|女生|男生)|初中(?:生|学生|女孩|男孩|女生|男生)|"
    r"中学(?:生|学生|女孩|男孩|女生|男生)|高中(?:生|学生|女孩|男孩|女生|男生)|"
    r"幼态|儿童比例|童颜|娃娃脸|青春期|稚嫩(?:面容|脸庞|外貌|五官)|未发育|"
    r"(?:十几|十来|十多)\s*(?:周岁|岁)|(?:未满|不满|低于|不到)\s*(?:18|十八)\s*(?:周岁|岁)?|"
    r"(?:18|十八)\s*(?:周岁|岁)\s*(?:及)?(?:以下|以内))"
    r"|(?:学龄前|未入学)"
    r"|(?<![a-z0-9_])(?:underage|minor(?:s|[-\s]+(?:person|child|girl|boy))|"
    r"(?:a|the)[-\s]+minor|"
    r"child(?:ren)?|loli|shota|prepubescent|juvenile|"
    r"adolescents?|preteens?|preschoolers?|"
    r"toddlers?|infants?|bab(?:y|ies)|newborns?|neonates?|kids?|"
    r"school[-\s]?(?:children|child|girls?|boys?)|school[-\s]+aged?|"
    r"(?:elementary|middle|high)[-\s]+school[-\s]+(?:students?|girls?|boys?)|"
    r"child[-\s]?like|teen(?:age[dr]?)?|"
    r"(?:under|below|less[-\s]+than)[-\s]*(?:the[-\s]+age[-\s]+of[-\s]+)?(?:18s?|eighteens?)|"
    r"(?:not[-\s]+yet|almost)[-\s]+eighteen|"
    r"young[-\s]+looking(?:[-\s]+(?:girls?|boys?|children?|persons?|characters?))?|"
    r"(?:young|little|teen(?:age[dr]?)?|school[-\s]?)\s*(?:girls?|boys?|children?|kids?)"
    r")(?![a-z0-9_])",
    flags=re.I,
)
LOCAL_SINGLE_IMAGE_CHINESE_AGE_PATTERN = re.compile(
    r"(?<![零〇一二三四五六七八九十百千万两])"
    r"([零〇一二三四五六七八九十百两]{1,6})(?:又半)?\s*(?:周岁|岁)"
)
LOCAL_SINGLE_IMAGE_CHINESE_AGE_RANGE_PATTERN = re.compile(
    r"(?<![零〇一二三四五六七八九十百千万两])"
    r"([零〇一二三四五六七八九十百两]{1,6})\s*(?:至|到|或|[/、~～—–-])\s*"
    r"([零〇一二三四五六七八九十百两]{1,6})\s*(?:周岁|岁)"
)
LOCAL_SINGLE_IMAGE_CHINESE_AMBIGUOUS_MINOR_RANGE_PATTERN = re.compile(
    r"(?<![零〇一二三四五六七八九十百千万两])十[一二三四五六七][一二三四五六七八九]\s*岁"
)
LOCAL_SINGLE_IMAGE_AGE_UNIT_PATTERN = (
    r"(?:周岁|岁|(?:yrs?|years?)(?:[-\s]*olds?)?|"
    r"y\.?\s*/?\s*o\.?|years?[-\s]+of[-\s]+age)"
)
LOCAL_SINGLE_IMAGE_ARABIC_AGE_VALUE_PATTERN = (
    r"[0-9]{1,3}(?:[.,][0-9]+|½|1⁄2|\s+(?:1/2|1⁄2))?"
)
LOCAL_SINGLE_IMAGE_ARABIC_AGE_RANGE_PATTERN = re.compile(
    rf"(?<![0-9.,/⁄])(?:between[-\s]+)?({LOCAL_SINGLE_IMAGE_ARABIC_AGE_VALUE_PATTERN})\s*"
    rf"(?:to|through|and|或|至|到|[/~～—–-])\s*({LOCAL_SINGLE_IMAGE_ARABIC_AGE_VALUE_PATTERN})[-\s]*"
    rf"{LOCAL_SINGLE_IMAGE_AGE_UNIT_PATTERN}(?![a-z0-9_])",
    flags=re.I,
)
LOCAL_SINGLE_IMAGE_ARABIC_AGE_PATTERN = re.compile(
    rf"(?<![0-9.,/⁄])({LOCAL_SINGLE_IMAGE_ARABIC_AGE_VALUE_PATTERN})"
    rf"(?:(?:又半)|[-\s]+and[-\s]+(?:(?:a|one)[-\s]+half|1\s*/\s*2))?[-\s]*"
    rf"{LOCAL_SINGLE_IMAGE_AGE_UNIT_PATTERN}(?![a-z0-9_])",
    flags=re.I,
)
LOCAL_SINGLE_IMAGE_ARABIC_AGE_LABELED_RANGE_PATTERN = re.compile(
    rf"(?<![a-z0-9_])(?:ages?|age[-\s]+range|aged)[-\s]*[:=]?[-\s]*"
    rf"(?:between[-\s]+)?({LOCAL_SINGLE_IMAGE_ARABIC_AGE_VALUE_PATTERN})\s*"
    rf"(?:to|through|and|or|[/~—–-])\s*({LOCAL_SINGLE_IMAGE_ARABIC_AGE_VALUE_PATTERN})"
    rf"(?:[-\s]*{LOCAL_SINGLE_IMAGE_AGE_UNIT_PATTERN})?(?![a-z0-9_])",
    flags=re.I,
)
LOCAL_SINGLE_IMAGE_ARABIC_AGE_LABEL_PATTERN = re.compile(
    r"(?<![a-z0-9_])(?:age|aged)[-\s]*[:=]?[-\s]*"
    rf"({LOCAL_SINGLE_IMAGE_ARABIC_AGE_VALUE_PATTERN})(?![a-z0-9_])",
    flags=re.I,
)
LOCAL_SINGLE_IMAGE_ENGLISH_NUMBER_PATTERN = (
    r"(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
    r"thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|"
    r"forty|fifty|sixty|seventy|eighty|ninety|hundred)"
    r"(?:[-\s]+(?:and[-\s]+)?(?:zero|one|two|three|four|five|six|seven|eight|nine|"
    r"ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|"
    r"twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)){0,8}"
)
LOCAL_SINGLE_IMAGE_ENGLISH_SIMPLE_NUMBER_PATTERN = (
    r"(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
    r"thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|"
    r"(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)"
    r"(?:[-\s]+(?:one|two|three|four|five|six|seven|eight|nine))?)"
)
LOCAL_SINGLE_IMAGE_ENGLISH_AGE_RANGE_PATTERN = re.compile(
    rf"(?<![-a-z0-9_])(?P<start>{LOCAL_SINGLE_IMAGE_ENGLISH_NUMBER_PATTERN}?)"
    rf"[-\s]+(?:to|through|[-~—–])[-\s]+(?P<end>{LOCAL_SINGLE_IMAGE_ENGLISH_NUMBER_PATTERN})"
    r"[-\s]+(?:years?|yrs?)[-\s]+old(?![a-z0-9_])",
    flags=re.I,
)
LOCAL_SINGLE_IMAGE_ENGLISH_AGE_BETWEEN_PATTERN = re.compile(
    rf"(?<![-a-z0-9_])between[-\s]+(?P<start>{LOCAL_SINGLE_IMAGE_ENGLISH_NUMBER_PATTERN}?)"
    rf"[-\s]+and[-\s]+(?P<end>{LOCAL_SINGLE_IMAGE_ENGLISH_NUMBER_PATTERN})"
    r"[-\s]+(?:years?|yrs?)[-\s]+old(?![a-z0-9_])",
    flags=re.I,
)
LOCAL_SINGLE_IMAGE_ENGLISH_AGE_AND_RANGE_PATTERN = re.compile(
    rf"(?<![-a-z0-9_])(?P<start>{LOCAL_SINGLE_IMAGE_ENGLISH_SIMPLE_NUMBER_PATTERN})"
    rf"[-\s]*(?:and|or|/)[-\s]*(?P<end>{LOCAL_SINGLE_IMAGE_ENGLISH_SIMPLE_NUMBER_PATTERN})"
    r"[-\s]+(?:years?|yrs?)[-\s]+olds?(?![a-z0-9_])",
    flags=re.I,
)
LOCAL_SINGLE_IMAGE_ENGLISH_AGE_LABELED_RANGE_PATTERN = re.compile(
    rf"(?<![-a-z0-9_])(?:ages?|age[-\s]+range|aged)[-\s]*[:=]?[-\s]*"
    rf"(?:between[-\s]+)?(?P<start>{LOCAL_SINGLE_IMAGE_ENGLISH_NUMBER_PATTERN}?)"
    rf"[-\s]*(?:to|through|and|or|/|[-~—–])[-\s]*"
    rf"(?P<end>{LOCAL_SINGLE_IMAGE_ENGLISH_NUMBER_PATTERN})"
    r"(?:[-\s]+(?:years?|yrs?)[-\s]+olds?)?(?![a-z0-9_])",
    flags=re.I,
)
LOCAL_SINGLE_IMAGE_ENGLISH_AGE_PATTERN = re.compile(
    rf"(?<![-a-z0-9_])(?:(?P<before>{LOCAL_SINGLE_IMAGE_ENGLISH_NUMBER_PATTERN})"
    r"(?:[-\s]+point[-\s]+(?:zero|one|two|three|four|five|six|seven|eight|nine))?"
    r"(?:[-\s]+and[-\s]+(?:(?:a|one)[-\s]+half|1\s*/\s*2))?"
    r"[-\s]+(?:years?|yrs?)[-\s]+old|"
    rf"(?P<short>{LOCAL_SINGLE_IMAGE_ENGLISH_NUMBER_PATTERN})[-\s]+"
    r"(?:y\.?\s*/?\s*o\.?|years?[-\s]+of[-\s]+age)|"
    rf"(?:age|aged)[-\s]*[:=]?[-\s]*(?P<after>{LOCAL_SINGLE_IMAGE_ENGLISH_NUMBER_PATTERN}))"
    r"(?![a-z0-9_])",
    flags=re.I,
)


class VisualContractError(ValueError):
    """Raised when model output does not satisfy a supported visual contract."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "visual-contract-invalid",
        semantic: bool = False,
        diagnostics: dict[str, Any] | None = None,
    ):
        self.code = code
        self.semantic = bool(semantic)
        self.diagnostics = {
            str(key): value
            for key, value in dict(diagnostics or {}).items()
            if isinstance(value, (str, int, float, bool)) or value is None
        }
        super().__init__(message)


def _clean_text(value: str, limit: int = 160) -> str:
    return re.sub(r"\s+", " ", value).strip()[:limit]


def _normalize_scan_text(value: Any) -> str:
    normalized = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return re.sub(r"\s+", " ", normalized).strip()


def _requirements_contain_explicit_minor_terms(requirements: str = "") -> bool:
    normalized = _normalize_scan_text(_clean_text(str(requirements or ""), 2000))
    return bool(
        normalized and REQUIREMENTS_EXPLICIT_MINOR_PATTERN.search(normalized)
    )


def _local_partial_requirements_contain_explicit_minor_terms(
    requirements: str = "",
) -> bool:
    normalized = _normalize_scan_text(_clean_text(str(requirements or ""), 2000))
    if not normalized:
        return False
    if re.search(
        r"(?<![a-z0-9_])minor[-\s]+characters?(?![a-z0-9_])",
        normalized,
        flags=re.I,
    ):
        return True
    normalized = LOCAL_SINGLE_IMAGE_NON_AGE_COMPOUND_PATTERN.sub(
        "颜色",
        normalized,
    )
    normalized = LOCAL_SINGLE_IMAGE_AGE_MODIFIED_NON_PERSON_PATTERN.sub(
        "物体",
        normalized,
    )
    normalized = LOCAL_SINGLE_IMAGE_TRUSTED_NON_PERSON_REFERENCE_PATTERN.sub(
        "物体",
        normalized,
    )
    if LOCAL_SINGLE_IMAGE_TRUSTED_NON_PERSON_NAME_PATTERN.fullmatch(normalized):
        return False
    preservation_object = re.fullmatch(
        r"(?:保留|保持|维持|保有|keep|preserve|retain|maintain)\s*(.+)",
        normalized,
        flags=re.I,
    )
    if (
        preservation_object
        and LOCAL_SINGLE_IMAGE_TRUSTED_NON_PERSON_NAME_PATTERN.fullmatch(
            preservation_object.group(1).strip()
        )
    ):
        return False
    return _local_single_image_text_has_explicit_minor_evidence(normalized)


def _requirements_contain_sensitive_terms(requirements: str = "") -> bool:
    normalized = _normalize_scan_text(_clean_text(str(requirements or ""), 2000))
    return bool(
        normalized
        and (
            SAFE_SENSITIVE_PATTERN.search(normalized)
            or re.search(r"(?<![a-z0-9_])(?:nude|naked)(?![a-z0-9_])", normalized, re.I)
        )
    )


def _scan_text_values(value: Any) -> list[str]:
    values: list[str] = []
    if isinstance(value, str):
        normalized = _normalize_scan_text(value)
        if normalized:
            values.append(normalized)
    elif isinstance(value, list):
        for item in value:
            values.extend(_scan_text_values(item))
    elif isinstance(value, dict):
        for item in value.values():
            values.extend(_scan_text_values(item))
    return values


def _local_single_image_asset_is_person_focused(contract: dict) -> bool:
    asset = _normalize_scan_text(contract.get("asset_type"))
    if not asset or LOCAL_SINGLE_IMAGE_TRUSTED_NON_PERSON_NAME_PATTERN.fullmatch(asset):
        return False
    return bool(
        PERSON_ASSET_TYPE_PATTERN.fullmatch(asset)
        or VISIBLE_PERSON_PATTERN.search(asset)
        or ZERO_PERSON_GENDER_SUBJECT_PATTERN.search(asset)
    )


def _local_single_image_entity_is_trusted_non_person(entity: Any) -> bool:
    if not isinstance(entity, dict) or entity.get("count") == "一名":
        return False
    name = _normalize_scan_text(entity.get("name"))
    if not (
        name
        and LOCAL_SINGLE_IMAGE_TRUSTED_NON_PERSON_NAME_PATTERN.fullmatch(name)
    ):
        return False
    if _normalize_scan_text(entity.get("pose")) or _normalize_scan_text(entity.get("action")):
        return False
    secondary_values = _scan_text_values([
        entity.get("appearance"),
        entity.get("materials"),
        entity.get("colors"),
    ])
    for text in secondary_values:
        if LOCAL_SINGLE_IMAGE_LIVING_PERSON_EVIDENCE_PATTERN.search(text):
            return False
        if _local_single_image_text_has_explicit_minor_evidence(text):
            return False
    return True


def _local_single_image_trusted_non_person_names(contract: dict) -> list[str]:
    names = [
        _normalize_scan_text(entity.get("name"))
        for entity in contract.get("entities") or []
        if _local_single_image_entity_is_trusted_non_person(entity)
    ]
    return sorted({name for name in names if name}, key=len, reverse=True)


def _local_single_image_text_has_person_age_context(text: str) -> bool:
    normalized = _normalize_scan_text(text)
    return bool(
        normalized
        and (
            VISIBLE_PERSON_PATTERN.search(normalized)
            or ZERO_PERSON_GENDER_SUBJECT_PATTERN.search(normalized)
            or LOCAL_SINGLE_IMAGE_EXPLICIT_MINOR_EVIDENCE_PATTERN.search(normalized)
            or LOCAL_SINGLE_IMAGE_LIVING_PERSON_EVIDENCE_PATTERN.search(normalized)
        )
    )


def _neutralize_local_single_image_known_object_references(
    value: Any,
    object_names: list[str],
) -> Any:
    if isinstance(value, str):
        normalized = _normalize_scan_text(value)
        for name in object_names:
            normalized = re.sub(re.escape(name), "物体", normalized, flags=re.I)
        normalized = LOCAL_SINGLE_IMAGE_NON_AGE_COMPOUND_PATTERN.sub(
            "颜色",
            normalized,
        )
        normalized = LOCAL_SINGLE_IMAGE_AGE_MODIFIED_NON_PERSON_PATTERN.sub(
            "物体",
            normalized,
        )
        normalized = LOCAL_SINGLE_IMAGE_TRUSTED_NON_PERSON_REFERENCE_PATTERN.sub(
            "物体",
            normalized,
        )
        return normalized
    if isinstance(value, list):
        return [
            _neutralize_local_single_image_known_object_references(item, object_names)
            for item in value
        ]
    if isinstance(value, dict):
        return {
            key: _neutralize_local_single_image_known_object_references(item, object_names)
            for key, item in value.items()
        }
    return value


def _local_single_image_age_evidence_values(contract: dict) -> list[str]:
    values: list[str] = []
    object_names = _local_single_image_trusted_non_person_names(contract)
    asset = _neutralize_local_single_image_known_object_references(
        contract.get("asset_type"),
        object_names,
    )
    asset_text = _normalize_scan_text(asset)
    asset_contract = {"asset_type": asset_text}
    if (
        asset_text
        and not LOCAL_SINGLE_IMAGE_TRUSTED_NON_PERSON_NAME_PATTERN.fullmatch(asset_text)
        and (
            _local_single_image_asset_is_person_focused(asset_contract)
            or _local_single_image_text_has_person_age_context(asset_text)
        )
    ):
        values.append(asset_text)
    for entity in contract.get("entities") or []:
        if not isinstance(entity, dict):
            continue
        if _local_single_image_entity_is_trusted_non_person(entity):
            continue
        person_scope = entity.get("count") == "一名"
        for key in ("name", "appearance", "pose", "action", "materials", "colors"):
            normalized_values = _scan_text_values(
                _neutralize_local_single_image_known_object_references(
                    entity.get(key),
                    object_names,
                )
            )
            values.extend(
                text
                for text in normalized_values
                if person_scope or _local_single_image_text_has_person_age_context(text)
            )
    relations = _neutralize_local_single_image_known_object_references(
        contract.get("relations"),
        object_names,
    )
    values.extend(
        text
        for text in _scan_text_values(relations)
        if _local_single_image_text_has_person_age_context(text)
    )
    safety = contract.get("content_safety") or {}
    facts = _neutralize_local_single_image_known_object_references(
        safety.get("sensitive_visible_facts"),
        object_names,
    )
    values.extend(_scan_text_values(facts))
    scene_values = _neutralize_local_single_image_known_object_references(
        contract.get("scene"),
        object_names,
    )
    values.extend(
        text
        for text in _scan_text_values(scene_values)
        if _local_single_image_text_has_person_age_context(text)
    )
    return values


def _parse_local_single_image_chinese_age(value: str) -> int | None:
    digits = {
        "零": 0,
        "〇": 0,
        "一": 1,
        "二": 2,
        "两": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
    }
    units = {"十": 10, "百": 100}
    total = 0
    number: int | None = None
    for char in value:
        if char in digits:
            number = digits[char]
            continue
        unit = units.get(char)
        if unit is None:
            return None
        total += (1 if number is None else number) * unit
        number = None
    return total + (0 if number is None else number)


def _parse_local_single_image_english_age(value: str) -> int | None:
    ones = {
        "zero": 0,
        "one": 1,
        "two": 2,
        "three": 3,
        "four": 4,
        "five": 5,
        "six": 6,
        "seven": 7,
        "eight": 8,
        "nine": 9,
        "ten": 10,
        "eleven": 11,
        "twelve": 12,
        "thirteen": 13,
        "fourteen": 14,
        "fifteen": 15,
        "sixteen": 16,
        "seventeen": 17,
        "eighteen": 18,
        "nineteen": 19,
    }
    tens = {
        "twenty": 20,
        "thirty": 30,
        "forty": 40,
        "fifty": 50,
        "sixty": 60,
        "seventy": 70,
        "eighty": 80,
        "ninety": 90,
    }
    total = 0
    current = 0
    for token in re.split(r"[-\s]+", value.lower().strip()):
        if not token or token == "and":
            continue
        if token in ones:
            current += ones[token]
        elif token in tens:
            current += tens[token]
        elif token == "hundred":
            current = max(1, current) * 100
        else:
            return None
    total += current
    return total


def _parse_local_single_image_numeric_age(value: str) -> float | None:
    normalized = _normalize_scan_text(value).replace(",", ".")
    if normalized.endswith(("1⁄2", "1/2")):
        normalized = f"{normalized[:-3].rstrip()}.5"
    if normalized.endswith("½"):
        normalized = f"{normalized[:-1]}.5"
    try:
        return float(normalized)
    except (TypeError, ValueError):
        return None


def _local_single_image_text_has_explicit_minor_evidence(text: str) -> bool:
    if LOCAL_SINGLE_IMAGE_EXPLICIT_MINOR_EVIDENCE_PATTERN.search(text):
        return True
    if LOCAL_SINGLE_IMAGE_CHINESE_AMBIGUOUS_MINOR_RANGE_PATTERN.search(text):
        return True
    for match in LOCAL_SINGLE_IMAGE_CHINESE_AGE_RANGE_PATTERN.finditer(text):
        ages = (
            _parse_local_single_image_chinese_age(match.group(1)),
            _parse_local_single_image_chinese_age(match.group(2)),
        )
        if any(age is not None and age < 18 for age in ages):
            return True
    for match in LOCAL_SINGLE_IMAGE_CHINESE_AGE_PATTERN.finditer(text):
        age = _parse_local_single_image_chinese_age(match.group(1))
        if age is not None and age < 18:
            return True
    for match in LOCAL_SINGLE_IMAGE_ARABIC_AGE_RANGE_PATTERN.finditer(text):
        if (
            match.group(1) == "1"
            and match.group(2) == "2"
            and re.search(r"(?:[0-9]{1,3}|and)\s*$", text[:match.start()], flags=re.I)
        ):
            continue
        ages = (
            _parse_local_single_image_numeric_age(match.group(1)),
            _parse_local_single_image_numeric_age(match.group(2)),
        )
        if any(age is not None and age < 18 for age in ages):
            return True
    for match in LOCAL_SINGLE_IMAGE_ARABIC_AGE_LABELED_RANGE_PATTERN.finditer(text):
        ages = (
            _parse_local_single_image_numeric_age(match.group(1)),
            _parse_local_single_image_numeric_age(match.group(2)),
        )
        if any(age is not None and age < 18 for age in ages):
            return True
    for match in LOCAL_SINGLE_IMAGE_ARABIC_AGE_PATTERN.finditer(text):
        age = _parse_local_single_image_numeric_age(match.group(1))
        if age is not None and age < 18:
            return True
    for match in LOCAL_SINGLE_IMAGE_ARABIC_AGE_LABEL_PATTERN.finditer(text):
        age = _parse_local_single_image_numeric_age(match.group(1))
        if age is not None and age < 18:
            return True
    for pattern in (
        LOCAL_SINGLE_IMAGE_ENGLISH_AGE_RANGE_PATTERN,
        LOCAL_SINGLE_IMAGE_ENGLISH_AGE_BETWEEN_PATTERN,
        LOCAL_SINGLE_IMAGE_ENGLISH_AGE_AND_RANGE_PATTERN,
        LOCAL_SINGLE_IMAGE_ENGLISH_AGE_LABELED_RANGE_PATTERN,
    ):
        for match in pattern.finditer(text):
            ages = (
                _parse_local_single_image_english_age(match.group("start")),
                _parse_local_single_image_english_age(match.group("end")),
            )
            if any(age is not None and age < 18 for age in ages):
                return True
    for match in LOCAL_SINGLE_IMAGE_ENGLISH_AGE_PATTERN.finditer(text):
        value = match.group("before") or match.group("short") or match.group("after")
        age = _parse_local_single_image_english_age(value)
        if age is not None and age < 18:
            return True
    return False


def _local_single_image_contract_has_explicit_minor_evidence(contract: dict) -> bool:
    safety = contract.get("content_safety") or {}
    if safety.get("age_assessment") == "young_or_minor_indicators":
        return True
    return any(
        _local_single_image_text_has_explicit_minor_evidence(text)
        for text in _local_single_image_age_evidence_values(contract)
    )


def _local_single_image_contract_has_ambiguous_age_noun(contract: dict) -> bool:
    return any(
        LOCAL_SINGLE_IMAGE_AMBIGUOUS_AGE_NOUN_PATTERN.search(text)
        for text in _local_single_image_age_evidence_values(contract)
    )


def _local_single_image_contract_has_mislabeled_living_person(contract: dict) -> bool:
    for entity in contract.get("entities") or []:
        if not isinstance(entity, dict) or entity.get("count") == "一名":
            continue
        if any(
            LOCAL_SINGLE_IMAGE_LIVING_PERSON_EVIDENCE_PATTERN.search(text)
            for text in _scan_text_values(entity)
        ):
            return True
    return False


def _neutralize_local_single_image_ambiguous_age_nouns(value: Any) -> Any:
    if isinstance(value, str):
        return LOCAL_SINGLE_IMAGE_AMBIGUOUS_AGE_NOUN_PATTERN.sub("人物", value)
    if isinstance(value, list):
        return [
            _neutralize_local_single_image_ambiguous_age_nouns(item)
            for item in value
        ]
    if isinstance(value, dict):
        return {
            key: _neutralize_local_single_image_ambiguous_age_nouns(item)
            for key, item in value.items()
        }
    return value


def _neutralize_local_single_image_non_age_contexts(contract: dict) -> dict:
    candidate = json.loads(json.dumps(contract, ensure_ascii=False))
    object_names = _local_single_image_trusted_non_person_names(contract)

    def neutralize(value: Any) -> Any:
        if isinstance(value, str):
            return RICH_SENSITIVE_YOUNG_PATTERN.sub("人物", value)
        if isinstance(value, list):
            return [neutralize(item) for item in value]
        if isinstance(value, dict):
            return {key: neutralize(item) for key, item in value.items()}
        return value

    candidate["asset_type"] = _neutralize_local_single_image_known_object_references(
        candidate.get("asset_type"),
        object_names,
    )
    if not _local_single_image_asset_is_person_focused(candidate):
        candidate["asset_type"] = neutralize(candidate.get("asset_type"))
    for entity in candidate.get("entities") or []:
        if not isinstance(entity, dict):
            continue
        for key in ("name", "appearance", "pose", "action", "materials", "colors"):
            entity[key] = _neutralize_local_single_image_known_object_references(
                entity.get(key),
                object_names,
            )
        if _local_single_image_entity_is_trusted_non_person(entity):
            for key in ("name", "appearance", "pose", "action", "materials", "colors"):
                entity[key] = neutralize(entity.get(key))
        else:
            for key in ("materials", "colors"):
                entity[key] = neutralize(entity.get(key))
    candidate["relations"] = _neutralize_local_single_image_known_object_references(
        candidate.get("relations"),
        object_names,
    )
    candidate_safety = candidate.get("content_safety") or {}
    candidate_safety["sensitive_visible_facts"] = (
        _neutralize_local_single_image_known_object_references(
            candidate_safety.get("sensitive_visible_facts"),
            object_names,
        )
    )
    for key in ("scene", "look", "camera_cues", "ocr", "uncertain"):
        candidate[key] = neutralize(candidate.get(key))
    return candidate


def _safe_projection_pose(value: Any) -> str:
    normalized = _normalize_scan_text(value)
    if normalized and SAFE_PROJECTION_POSE_PATTERN.fullmatch(normalized):
        return _clean_text(str(value or ""), 120)
    return ""


def _require_object(value: Any, path: str) -> dict:
    if not isinstance(value, dict):
        raise VisualContractError(f"{path} must be an object")
    return value


def _require_exact_keys(value: dict, expected: tuple[str, ...], path: str) -> None:
    actual = set(value)
    required = set(expected)
    if actual != required:
        missing = sorted(required - actual)
        extra = sorted(actual - required)
        raise VisualContractError(f"{path} keys mismatch; missing={missing}; extra={extra}")


def _nullable_text(value: Any, path: str, limit: int = 160) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise VisualContractError(f"{path} must be a string or null")
    return _clean_text(value, limit)


def _required_text(value: Any, path: str, limit: int = 160) -> str:
    if not isinstance(value, str):
        raise VisualContractError(f"{path} must be a string")
    return _clean_text(value, limit)


def _text_list(value: Any, path: str, max_items: int = 16, item_limit: int = 160) -> list[str]:
    if not isinstance(value, list):
        raise VisualContractError(f"{path} must be an array")
    if len(value) > max_items:
        raise VisualContractError(f"{path} has too many items")
    result: list[str] = []
    for index, item in enumerate(value):
        if item is None or item == "":
            continue
        if not isinstance(item, str):
            raise VisualContractError(f"{path}[{index}] must be a string")
        cleaned = _clean_text(item, item_limit)
        if cleaned and cleaned not in result:
            result.append(cleaned)
    return result


def _enum_text(value: Any, allowed: set[str], path: str) -> str:
    if not isinstance(value, str):
        raise VisualContractError(f"{path} must be a string")
    normalized = value.strip()
    if normalized not in allowed:
        raise VisualContractError(
            f"{path} has unsupported value",
            code="visual-contract-semantic-invalid",
            semantic=True,
        )
    return normalized


def _enum_list(value: Any, allowed: set[str], path: str, max_items: int = 8) -> list[str]:
    values = _text_list(value, path, 16, 80)
    for item in values:
        if item not in allowed:
            raise VisualContractError(
                f"{path} contains unsupported value",
                code="visual-contract-semantic-invalid",
                semantic=True,
            )
    if len(values) > max_items:
        raise VisualContractError(
            f"{path} has too many unique items",
            code="visual-contract-semantic-invalid",
            semantic=True,
        )
    return values


def _bounded_int(value: Any, path: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise VisualContractError(f"{path} must be an integer")
    if isinstance(value, float):
        if not math.isfinite(value) or not value.is_integer():
            raise VisualContractError(f"{path} must be an integer")
        value = int(value)
    if value < minimum or value > maximum:
        raise VisualContractError(
            f"{path} must be between {minimum} and {maximum}",
            code="visual-contract-semantic-invalid",
            semantic=True,
        )
    return value


def _json_payload_text(raw_output: str) -> str:
    text = str(raw_output or "").strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.I | re.S)
    if fenced:
        text = fenced.group(1).strip()
    return text


def _parse_json_object(raw_output: str, *, reject_duplicate_keys: bool = False) -> dict:
    text = _json_payload_text(raw_output)

    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict:
        parsed_object: dict = {}
        for key, value in pairs:
            if key in parsed_object:
                raise VisualContractError(f"duplicate JSON key: {key}")
            parsed_object[key] = value
        return parsed_object

    try:
        parsed = json.loads(
            text,
            object_pairs_hook=reject_duplicates if reject_duplicate_keys else None,
        )
    except json.JSONDecodeError as exc:
        raise VisualContractError(f"invalid JSON: {exc.msg}") from exc
    return _require_object(parsed, "root")


def _compact_text_list(
    value: Any,
    path: str,
    max_items: int = 8,
    item_limit: int = 160,
) -> list[str]:
    """Normalize occasional Qwen scalar drift without weakening exact keys."""

    if value is None or value == "":
        value = []
    elif isinstance(value, str):
        value = [value]
    return _text_list(value, path, max_items, item_limit)


def _neutralize_compact_young_wording(value: str) -> str:
    return _clean_text(YOUNG_AGE_PATTERN.sub("人物", str(value or "")), 160)


def local_compact_visual_contract_instruction(
    *,
    allow_uncertain_age: bool = True,
) -> str:
    """Return the single-line, low-token Local-only nf.visual.v2 IR prompt."""

    skeleton = {
        "asset": "",
        "level": "safe|suggestive|nudity|explicit|uncertain",
        "body": "none|partial|full|uncertain",
        "interaction": "none|intimate|sexual|uncertain",
        "age": (
            "adult_appearing|age_unverifiable|young_or_minor_indicators|not_applicable|uncertain"
            if allow_uncertain_age
            else "adult_appearing|age_unverifiable|young_or_minor_indicators|not_applicable"
        ),
        "people": 0,
        "entities": [{
            "kind": "person|partial_person|object",
            "name": "",
            "appearance": [],
            "pose": "",
            "action": "",
            "materials": [],
            "colors": [],
        }],
        "relations": [],
        "scene": {"environment": "", "background": "", "spatial_layers": []},
        "look": {
            "lighting": [],
            "palette": [],
            "materials": [],
            "style": [],
            "atmosphere": "",
            "finish": "",
        },
        "camera": {"shot": "", "angle": "", "composition": "", "depth_of_field": ""},
        "signals": [],
        "facts": [],
    }
    instruction = (
        "只输出一行合法JSON。exact 13键及嵌套键顺序："
        f"{json.dumps(skeleton, ensure_ascii=False, separators=(',', ':'))}。"
        "模板值非答案；asset必填；仅写直接可见事实，未知空值。"
        "people填可见完整或局部人形参与者数（动漫/兽耳也算），最多3；entities中person和partial_person数量必须等于people，"
        "局部人物用partial_person，非人物主体用object；每名参与者单独一项，不得合并。"
        "总输出以约900字符为软目标并尽量精简；entities建议最多4项，每项appearance建议最多4项、materials和colors各建议最多3项；"
        "relations、scene.spatial_layers及look各数组建议最多3项，signals建议最多6项，facts建议最多3项。"
        "联动：partial/full须nudity；sexual须explicit_activity；敏感level须facts；非safe且age不明须age_ambiguous。"
        "互动必须在对应entity.action、relations、facts中分别写清可见关系两端、接触部位和具体动作；不得只写自慰、性行为或成人互动等标签。"
        "entity.materials写该主体局部材质与表面质感；look.materials写全局或环境材质。"
        "scene分开写环境、背景、前中后景；look分开写光线、色板、材质、风格、氛围、完成质感；"
        "camera分开写景别、视角、构图、景深，不得把中近景等景别写进composition。"
        "signals限nudity,sexualized_pose,explicit_activity,explicit_anatomy,sexual_fluid,age_ambiguous。"
        "age覆盖所有可见参与者：全部明显成年=adult_appearing，任一年龄不明=age_unverifiable，任一年轻证据=young_or_minor_indicators，0人=not_applicable。"
    )
    if "\n" in instruction or "\r" in instruction or len(instruction) > 1800:
        raise AssertionError(
            f"Local compact visual instruction must be one line and <=1800 chars: {len(instruction)}"
        )
    return instruction


def local_static_compact_visual_contract_instruction() -> str:
    """Return the bounded positional IR used only by ordinary single-image Local v2."""

    skeleton = {
        "n2": [
            "",
            0,
            0,
            0,
            3,
            0,
            [[0, "", "", "", "", "", ""]],
            "",
            ["", "", ""],
            ["", "", "", "", "", ""],
            ["", "", "", ""],
            [],
            "",
        ]
    }
    instruction = (
        "只输出一行合法JSON，根对象只能有n2版本键；n2必须严格13项且顺序固定："
        f"{json.dumps(skeleton, ensure_ascii=False, separators=(',', ':'))}。"
        "模板值不是答案，必须重新观察图片；未知用空字符串或空数组，禁止省项、增项、解释、Markdown。"
        "位置依次为0资产类型；1内容级别(0安全/1暗示/2裸露/3明确/4不确定)；"
        "2身体暴露(0无/1部分/2完整/3不确定)；3互动(0无/1亲密/2性互动/3不确定)；"
        "4年龄(0明显成年/1无法判断/2有年轻或未成年迹象/3不适用/4不确定)；5可见完整或局部参与者人数(最多3，动漫或兽耳人物也算)；"
        "6实体数组，每项严格7位[kind,name,appearance,pose,action,materials,colors]，kind为0完整人物/1局部人物/2物体，"
        "每名完整或局部参与者必须各占一项，0和1的项数必须等于位置5；"
        "7关系；8场景[环境,背景,空间层次]；9观感[光线,色板,全局材质,风格,氛围,完成质感]；"
        "10镜头[景别,视角,构图,景深]；11信号短码数组(n裸露,p性化姿态,x明确活动,a明确解剖,f体液,u年龄不明)；12敏感可见事实。"
        "appearance/materials/colors、关系、空间层次、观感前四项和事实优先只写一个短字符串，需要多个时才用数组；"
        "所有描述短而具体，总输出以360字符为目标。partial/full必须含n，sexual必须含x；非安全且年龄不明必须含u。"
        "互动必须在对应实体action、关系、事实三处分别写清可见的关系两端、接触部位和具体动作，不能只写泛化标签；"
        "只写直接可见事实，不猜测，不因题材省略。"
    )
    if "\n" in instruction or "\r" in instruction or len(instruction) > 1800:
        raise AssertionError(
            "Local static compact visual instruction must be one line and <=1800 "
            f"chars: {len(instruction)}"
        )
    return instruction


def _parse_legacy_local_compact_visual_contract(
    raw_output: str,
    *,
    validate_semantics: bool = True,
    allow_projection_redaction: bool = False,
) -> dict:
    """Map the Local 19-key compact IR into the canonical nf.visual.v2 contract."""

    compact = _parse_json_object(raw_output, reject_duplicate_keys=True)
    # Read compatibility for responses produced by the pre-compact Local prompt.
    if compact.get("schema") == SCHEMA_VERSION_V2:
        return parse_visual_contract(
            raw_output,
            expected_schema=SCHEMA_VERSION_V2,
            validate_semantics=validate_semantics,
            allow_projection_redaction=allow_projection_redaction,
        )
    _require_exact_keys(compact, LOCAL_COMPACT_LEGACY_KEYS, "local_compact")

    enum_text = (
        _enum_text
        if validate_semantics
        else lambda value, _allowed, path: _required_text(value, path, 80)
    )
    level = enum_text(compact["level"], CONTENT_LEVELS, "local_compact.level")
    body = enum_text(compact["body"], BODY_EXPOSURES, "local_compact.body")
    interaction = enum_text(
        compact["interaction"], INTERACTION_CATEGORIES, "local_compact.interaction"
    )
    compact_age = enum_text(
        compact["age"],
        AGE_ASSESSMENTS | {"uncertain"},
        "local_compact.age",
    )
    # Compact "uncertain" is deliberately mapped to the legacy conservative
    # bucket so existing generation gates block it instead of treating it as an
    # adult candidate. This is a safety state, not a claim of youth.
    age = (
        "ambiguous_or_young_appearing"
        if compact_age == "uncertain"
        else compact_age
    )
    people = _bounded_int(compact["people"], "local_compact.people", 0, 12)
    asset = _nullable_text(compact["asset"], "local_compact.asset", 40)
    subject = _nullable_text(compact["subject"], "local_compact.subject", 120)
    if not asset:
        raise VisualContractError("local_compact.asset must be non-empty")
    if people > 0 and not subject:
        raise VisualContractError("local_compact.subject must be non-empty when people > 0")
    if validate_semantics and people > 1:
        raise VisualContractError(
            "local_compact cannot assign per-person facts when people > 1",
            code="visual-contract-semantic-invalid",
            semantic=True,
        )

    appearance = _compact_text_list(compact["appearance"], "local_compact.appearance", 6, 160)
    relations = _compact_text_list(compact["relations"], "local_compact.relations", 8, 160)
    materials = _compact_text_list(compact["materials"], "local_compact.materials", 6, 100)
    colors = _compact_text_list(compact["colors"], "local_compact.colors", 6, 100)
    lighting = _compact_text_list(compact["lighting"], "local_compact.lighting", 6, 120)
    style = _compact_text_list(compact["style"], "local_compact.style", 6, 120)
    facts = _compact_text_list(compact["facts"], "local_compact.facts", 6, 160)
    raw_signals = _compact_text_list(compact["signals"], "local_compact.signals", 8, 80)
    signals = (
        _enum_list(raw_signals, CONTENT_SIGNALS, "local_compact.signals", 8)
        if validate_semantics
        else raw_signals
    )
    # Normalize only implications already asserted by the compact categorical
    # fields. These are contract metadata, not newly invented visual facts.
    if body in {"partial", "full"} and "nudity" not in signals:
        signals.append("nudity")
    if interaction == "sexual" and "explicit_activity" not in signals:
        signals.append("explicit_activity")
    if (
        level != "safe"
        and age in AGE_ASSESSMENTS_REQUIRING_AMBIGUOUS_SIGNAL
        and "age_ambiguous" not in signals
    ):
        signals.append("age_ambiguous")
    pose = _nullable_text(compact["pose"], "local_compact.pose", 120)
    action = _nullable_text(compact["action"], "local_compact.action", 160)

    compact_ordinary_values = (
        asset,
        subject,
        *appearance,
        pose,
        action,
        *relations,
        *materials,
        *colors,
        *lighting,
        *style,
        _nullable_text(compact["scene"], "local_compact.scene", 200),
        _nullable_text(compact["camera"], "local_compact.camera", 160),
    )
    has_young_wording = any(
        YOUNG_AGE_PATTERN.search(_normalize_scan_text(value))
        for value in (*compact_ordinary_values, *facts)
        if value
    )
    if (
        level != "safe"
        and age != "young_or_minor_indicators"
        and has_young_wording
    ):
        # Do not let an age-coded noun silently certify an adult subject. Keep
        # the visible facts but neutralize the noun and require user adulthood
        # confirmation through the existing age_unverifiable gate.
        age = "age_unverifiable"
        if "age_ambiguous" not in signals:
            signals.append("age_ambiguous")
        asset = _neutralize_compact_young_wording(asset)
        subject = _neutralize_compact_young_wording(subject)
        appearance = [_neutralize_compact_young_wording(value) for value in appearance]
        pose = _neutralize_compact_young_wording(pose)
        action = _neutralize_compact_young_wording(action)
        relations = [_neutralize_compact_young_wording(value) for value in relations]
        materials = [_neutralize_compact_young_wording(value) for value in materials]
        colors = [_neutralize_compact_young_wording(value) for value in colors]
        lighting = [_neutralize_compact_young_wording(value) for value in lighting]
        style = [_neutralize_compact_young_wording(value) for value in style]
        facts = [_neutralize_compact_young_wording(value) for value in facts]

    if people == 0:
        compact_person_fields = (
            asset,
            subject,
            *appearance,
            pose,
            action,
            *relations,
            *facts,
        )
        if PERSON_ASSET_TYPE_PATTERN.fullmatch(_normalize_scan_text(asset)) or any(
            VISIBLE_PERSON_PATTERN.search(_normalize_scan_text(text))
            or ZERO_PERSON_GENDER_SUBJECT_PATTERN.search(_normalize_scan_text(text))
            for text in compact_person_fields
            if text
        ):
            raise VisualContractError(
                "local_compact.people=0 conflicts with visible person semantics",
                code="visual-contract-semantic-invalid",
                semantic=True,
            )

    if interaction != "none" and not relations:
        for visible_text in (action, *facts):
            normalized_text = _normalize_scan_text(visible_text)
            if (
                INTERACTION_RELATION_EVIDENCE_PATTERN.search(normalized_text)
                and _has_concrete_interaction_action(normalized_text)
            ):
                # Copy an already supplied visible fact verbatim; never invent
                # participants, body parts, contact, or off-frame information.
                relations.append(visible_text)
                break

    entities: list[dict] = []
    if people > 0:
        entities.append({
            "name": subject,
            "count": "一名",
            "appearance": appearance,
            "pose": pose or None,
            "action": action or None,
            "materials": materials,
            "colors": colors,
        })
    elif subject:
        entities.append({
            "name": subject,
            "count": "一个",
            "appearance": appearance,
            "pose": pose or None,
            "action": action or None,
            "materials": materials,
            "colors": colors,
        })

    canonical = {
        "schema": SCHEMA_VERSION_V2,
        "asset_type": asset,
        "entities": entities,
        "relations": relations,
        "scene": {
            "environment": _neutralize_compact_young_wording(compact["scene"])
            if level != "safe" and age == "age_unverifiable" and has_young_wording
            else _nullable_text(compact["scene"], "local_compact.scene", 200),
            "background": None,
            "spatial_layers": [],
        },
        "look": {
            "lighting": lighting,
            "palette": [],
            "materials": [],
            "style": style,
            "atmosphere": None,
            "finish": None,
        },
        "camera_cues": {
            "shot": None,
            "angle": None,
            "composition": _neutralize_compact_young_wording(compact["camera"])
            if level != "safe" and age == "age_unverifiable" and has_young_wording
            else _nullable_text(compact["camera"], "local_compact.camera", 160),
            "depth_of_field": None,
        },
        "ocr": [],
        "uncertain": [],
        "content_safety": {
            "level": level,
            "body_exposure": body,
            "interaction_category": interaction,
            "age_assessment": age,
            "visible_person_count": people,
            "signals": signals,
            "sensitive_visible_facts": facts,
        },
    }
    return parse_visual_contract(
        json.dumps(canonical, ensure_ascii=False),
        expected_schema=SCHEMA_VERSION_V2,
        validate_semantics=validate_semantics,
        allow_projection_redaction=allow_projection_redaction,
    )


def parse_local_compact_visual_contract(
    raw_output: str,
    *,
    validate_semantics: bool = True,
    allow_projection_redaction: bool = False,
    allow_legacy_read: bool = True,
    allow_young_wording_neutralization: bool = True,
    allow_incomplete_participants: bool = False,
) -> dict:
    """Map the current Local compact IR into the canonical nf.visual.v2 contract."""

    compact = _parse_json_object(raw_output, reject_duplicate_keys=True)
    if allow_legacy_read and compact.get("schema") == SCHEMA_VERSION_V2:
        return parse_visual_contract(
            raw_output,
            expected_schema=SCHEMA_VERSION_V2,
            validate_semantics=validate_semantics,
            allow_projection_redaction=allow_projection_redaction,
        )
    if allow_legacy_read and set(compact) == set(LOCAL_COMPACT_LEGACY_KEYS):
        return _parse_legacy_local_compact_visual_contract(
            raw_output,
            validate_semantics=validate_semantics,
            allow_projection_redaction=allow_projection_redaction,
        )
    _require_exact_keys(compact, LOCAL_COMPACT_KEYS, "local_compact")
    enum_text = (
        _enum_text
        if validate_semantics
        else lambda value, _allowed, path: _required_text(value, path, 80)
    )
    level = enum_text(compact["level"], CONTENT_LEVELS, "local_compact.level")
    body = enum_text(compact["body"], BODY_EXPOSURES, "local_compact.body")
    interaction = enum_text(
        compact["interaction"], INTERACTION_CATEGORIES, "local_compact.interaction"
    )
    compact_age = enum_text(
        compact["age"],
        AGE_ASSESSMENTS | {"uncertain"},
        "local_compact.age",
    )
    age = (
        "ambiguous_or_young_appearing"
        if compact_age == "uncertain"
        else compact_age
    )
    people = _bounded_int(compact["people"], "local_compact.people", 0, 3)
    asset = _nullable_text(compact["asset"], "local_compact.asset", 40)
    if not asset:
        raise VisualContractError("local_compact.asset must be non-empty")

    raw_entities = compact["entities"]
    if not isinstance(raw_entities, list):
        raise VisualContractError("local_compact.entities must be an array")
    if len(raw_entities) > _MAX_ENTITIES:
        raise VisualContractError("local_compact.entities has too many items")
    compact_entities: list[dict] = []
    person_entity_count = 0
    for index, raw_entity in enumerate(raw_entities):
        entity = _require_object(raw_entity, f"local_compact.entities[{index}]")
        _require_exact_keys(
            entity,
            LOCAL_COMPACT_ENTITY_KEYS,
            f"local_compact.entities[{index}]",
        )
        kind = enum_text(
            entity["kind"],
            LOCAL_COMPACT_ENTITY_KINDS,
            f"local_compact.entities[{index}].kind",
        )
        name = _required_text(
            entity["name"], f"local_compact.entities[{index}].name", 120
        )
        if not name:
            raise VisualContractError(
                f"local_compact.entities[{index}].name must be non-empty"
            )
        if kind in {"person", "partial_person"}:
            person_entity_count += 1
        compact_entities.append({
            "kind": kind,
            "name": name,
            "appearance": _compact_text_list(
                entity["appearance"],
                f"local_compact.entities[{index}].appearance",
                16,
                160,
            ),
            "pose": _nullable_text(
                entity["pose"], f"local_compact.entities[{index}].pose", 120
            ),
            "action": _nullable_text(
                entity["action"], f"local_compact.entities[{index}].action", 160
            ),
            "materials": _compact_text_list(
                entity["materials"],
                f"local_compact.entities[{index}].materials",
                12,
                100,
            ),
            "colors": _compact_text_list(
                entity["colors"],
                f"local_compact.entities[{index}].colors",
                12,
                100,
            ),
        })
    if allow_incomplete_participants and validate_semantics:
        raise ValueError(
            "allow_incomplete_participants requires validate_semantics=False"
        )
    if person_entity_count != people and not allow_incomplete_participants:
        raise VisualContractError(
            "local_compact person and partial_person entities must match people",
            code="visual-contract-semantic-invalid",
            semantic=True,
        )

    relations = _compact_text_list(
        compact["relations"], "local_compact.relations", 20, 160
    )
    facts = _compact_text_list(compact["facts"], "local_compact.facts", 6, 160)
    raw_signals = _compact_text_list(
        compact["signals"], "local_compact.signals", 8, 80
    )
    signals = (
        _enum_list(raw_signals, CONTENT_SIGNALS, "local_compact.signals", 8)
        if validate_semantics
        else raw_signals
    )
    if body in {"partial", "full"} and "nudity" not in signals:
        signals.append("nudity")
    if interaction == "sexual" and "explicit_activity" not in signals:
        signals.append("explicit_activity")
    if (
        level != "safe"
        and age in AGE_ASSESSMENTS_REQUIRING_AMBIGUOUS_SIGNAL
        and "age_ambiguous" not in signals
    ):
        signals.append("age_ambiguous")

    scene = _require_object(compact["scene"], "local_compact.scene")
    _require_exact_keys(scene, SCENE_KEYS, "local_compact.scene")
    normalized_scene = {
        "environment": _nullable_text(
            scene["environment"], "local_compact.scene.environment", 200
        ),
        "background": _nullable_text(
            scene["background"], "local_compact.scene.background", 200
        ),
        "spatial_layers": _compact_text_list(
            scene["spatial_layers"],
            "local_compact.scene.spatial_layers",
            12,
            160,
        ),
    }
    look = _require_object(compact["look"], "local_compact.look")
    _require_exact_keys(look, LOOK_KEYS, "local_compact.look")
    normalized_look = {
        "lighting": _compact_text_list(
            look["lighting"], "local_compact.look.lighting", 12, 120
        ),
        "palette": _compact_text_list(
            look["palette"], "local_compact.look.palette", 12, 100
        ),
        "materials": _compact_text_list(
            look["materials"], "local_compact.look.materials", 12, 100
        ),
        "style": _compact_text_list(
            look["style"], "local_compact.look.style", 12, 120
        ),
        "atmosphere": _nullable_text(
            look["atmosphere"], "local_compact.look.atmosphere", 120
        ),
        "finish": _nullable_text(
            look["finish"], "local_compact.look.finish", 120
        ),
    }
    camera = _require_object(compact["camera"], "local_compact.camera")
    _require_exact_keys(camera, CAMERA_KEYS, "local_compact.camera")
    normalized_camera = {
        "shot": _nullable_text(camera["shot"], "local_compact.camera.shot", 100),
        "angle": _nullable_text(camera["angle"], "local_compact.camera.angle", 100),
        "composition": _nullable_text(
            camera["composition"], "local_compact.camera.composition", 160
        ),
        "depth_of_field": _nullable_text(
            camera["depth_of_field"],
            "local_compact.camera.depth_of_field",
            100,
        ),
    }

    compact_ordinary_values = [asset]
    for entity in compact_entities:
        compact_ordinary_values.extend([
            entity["name"],
            *entity["appearance"],
            entity["pose"],
            entity["action"],
            *entity["materials"],
            *entity["colors"],
        ])
    compact_ordinary_values.extend([
        *relations,
        normalized_scene["environment"],
        normalized_scene["background"],
        *normalized_scene["spatial_layers"],
        *normalized_look["lighting"],
        *normalized_look["palette"],
        *normalized_look["materials"],
        *normalized_look["style"],
        normalized_look["atmosphere"],
        normalized_look["finish"],
        *normalized_camera.values(),
    ])
    has_young_wording = any(
        YOUNG_AGE_PATTERN.search(_normalize_scan_text(value))
        for value in (*compact_ordinary_values, *facts)
        if value
    )
    if (
        level != "safe"
        and age != "young_or_minor_indicators"
        and has_young_wording
    ):
        if not allow_young_wording_neutralization and validate_semantics:
            raise VisualContractError(
                "local_compact sensitive ordinary fields contain young-age wording",
                code="visual-contract-semantic-invalid",
                semantic=True,
            )
        if allow_young_wording_neutralization:
            age = "age_unverifiable"
            if "age_ambiguous" not in signals:
                signals.append("age_ambiguous")
            asset = _neutralize_compact_young_wording(asset)
            for entity in compact_entities:
                for key in ("name", "pose", "action"):
                    entity[key] = _neutralize_compact_young_wording(entity[key])
                for key in ("appearance", "materials", "colors"):
                    entity[key] = [
                        _neutralize_compact_young_wording(value)
                        for value in entity[key]
                    ]
            relations = [
                _neutralize_compact_young_wording(value) for value in relations
            ]
            facts = [_neutralize_compact_young_wording(value) for value in facts]
            for key in ("environment", "background"):
                normalized_scene[key] = _neutralize_compact_young_wording(
                    normalized_scene[key]
                )
            normalized_scene["spatial_layers"] = [
                _neutralize_compact_young_wording(value)
                for value in normalized_scene["spatial_layers"]
            ]
            for key in ("lighting", "palette", "materials", "style"):
                normalized_look[key] = [
                    _neutralize_compact_young_wording(value)
                    for value in normalized_look[key]
                ]
            for key in ("atmosphere", "finish"):
                normalized_look[key] = _neutralize_compact_young_wording(
                    normalized_look[key]
                )
            for key in CAMERA_KEYS:
                normalized_camera[key] = _neutralize_compact_young_wording(
                    normalized_camera[key]
                )

    if interaction != "none" and not relations:
        visible_actions = [
            entity["action"] for entity in compact_entities if entity["action"]
        ]
        for visible_text in (*visible_actions, *facts):
            normalized_text = _normalize_scan_text(visible_text)
            if (
                INTERACTION_RELATION_EVIDENCE_PATTERN.search(normalized_text)
                and _has_concrete_interaction_action(normalized_text)
            ):
                relations.append(visible_text)
                break

    canonical_entities: list[dict] = []
    for entity in compact_entities:
        appearance = list(entity["appearance"])
        if entity["kind"] == "partial_person" and "局部可见" not in appearance:
            appearance.append("局部可见")
        canonical_entities.append({
            "name": entity["name"],
            "count": "一名" if entity["kind"] != "object" else "一个",
            "appearance": appearance,
            "pose": entity["pose"] or None,
            "action": entity["action"] or None,
            "materials": list(entity["materials"]),
            "colors": list(entity["colors"]),
        })

    canonical = {
        "schema": SCHEMA_VERSION_V2,
        "asset_type": asset,
        "entities": canonical_entities,
        "relations": relations,
        "scene": normalized_scene,
        "look": normalized_look,
        "camera_cues": normalized_camera,
        "ocr": [],
        "uncertain": [],
        "content_safety": {
            "level": level,
            "body_exposure": body,
            "interaction_category": interaction,
            "age_assessment": age,
            "visible_person_count": people,
            "signals": signals,
            "sensitive_visible_facts": facts,
        },
    }
    return parse_visual_contract(
        json.dumps(canonical, ensure_ascii=False),
        expected_schema=SCHEMA_VERSION_V2,
        validate_semantics=validate_semantics,
        allow_projection_redaction=allow_projection_redaction,
    )


def _local_single_image_full_age_scan_contract(
    raw_compact: dict,
    structural: dict,
) -> dict:
    """Restore untruncated Local text fields for route-scoped age evidence scans."""

    def raw_text_list(value: Any) -> list:
        if value is None or value == "":
            return []
        if isinstance(value, str):
            return [value]
        return list(value)

    candidate = json.loads(json.dumps(structural, ensure_ascii=False))
    candidate["asset_type"] = raw_compact["asset"]
    candidate["entities"] = [
        {
            "name": raw_entity["name"],
            "count": (
                "一名"
                if raw_entity["kind"] in {"person", "partial_person"}
                else "一个"
            ),
            "appearance": raw_text_list(raw_entity["appearance"]),
            "pose": raw_entity["pose"],
            "action": raw_entity["action"],
            "materials": raw_text_list(raw_entity["materials"]),
            "colors": raw_text_list(raw_entity["colors"]),
        }
        for raw_entity in raw_compact["entities"]
    ]
    candidate["relations"] = raw_text_list(raw_compact["relations"])
    candidate["scene"] = json.loads(
        json.dumps(raw_compact["scene"], ensure_ascii=False)
    )
    candidate["look"] = json.loads(
        json.dumps(raw_compact["look"], ensure_ascii=False)
    )
    candidate["camera_cues"] = json.loads(
        json.dumps(raw_compact["camera"], ensure_ascii=False)
    )
    candidate["content_safety"]["sensitive_visible_facts"] = raw_text_list(
        raw_compact["facts"]
    )
    return candidate


def parse_local_single_image_compact_visual_contract(
    raw_output: str,
    *,
    validate_semantics: bool = True,
    allow_projection_redaction: bool = False,
    allow_incomplete_participants: bool = False,
) -> dict:
    """Parse the strict Local single-image IR without treating weak age nouns as proof."""

    structural = parse_local_compact_visual_contract(
        raw_output,
        validate_semantics=False,
        allow_projection_redaction=allow_projection_redaction,
        allow_legacy_read=False,
        allow_young_wording_neutralization=False,
        allow_incomplete_participants=allow_incomplete_participants,
    )

    # The compact parser intentionally bounds asset_type to 40 characters. Preserve
    # the complete raw fields long enough to prove that an age phrase belongs to a
    # person rather than a non-person object before any field bound can cut away
    # the decisive noun.
    raw_asset_adjusted = False
    raw_compact = _parse_json_object(raw_output, reject_duplicate_keys=True)
    full_age_scan_contract = _local_single_image_full_age_scan_contract(
        raw_compact,
        structural,
    )
    raw_asset = raw_compact.get("asset")
    if isinstance(raw_asset, str):
        complete_asset = re.sub(
            r"\s+",
            " ",
            unicodedata.normalize("NFKC", raw_asset),
        ).strip()
        normalized_complete_asset = _normalize_scan_text(complete_asset)
        neutral_asset = _neutralize_local_single_image_known_object_references(
            complete_asset,
            _local_single_image_trusted_non_person_names(full_age_scan_contract),
        )
        if neutral_asset != normalized_complete_asset:
            structural["asset_type"] = _clean_text(neutral_asset, 40)
            raw_asset_adjusted = True

    safety = structural.get("content_safety") or {}
    sensitive_level = safety.get("level") in {"suggestive", "nudity", "explicit"}
    visible_person_count = safety.get("visible_person_count")
    age_assessment = safety.get("age_assessment")
    if (
        sensitive_level
        and isinstance(visible_person_count, int)
        and visible_person_count > 0
        and age_assessment in SENSITIVE_CANDIDATE_AGE_ASSESSMENTS
    ):
        if _local_single_image_contract_has_explicit_minor_evidence(
            full_age_scan_contract
        ):
            raise VisualContractError(
                "local_compact sensitive fields contain explicit minor evidence",
                code="visual-contract-semantic-invalid",
                semantic=True,
            )
        if _local_single_image_contract_has_mislabeled_living_person(
            full_age_scan_contract
        ):
            raise VisualContractError(
                "local_compact object entity contains living person evidence",
                code="visual-contract-semantic-invalid",
                semantic=True,
            )
        neutralized = _neutralize_local_single_image_non_age_contexts(structural)
        if _local_single_image_contract_has_ambiguous_age_noun(
            full_age_scan_contract
        ):
            neutralized = _neutralize_local_single_image_ambiguous_age_nouns(neutralized)
            neutralized_safety = neutralized["content_safety"]
            neutralized_safety["age_assessment"] = "age_unverifiable"
            signals = list(neutralized_safety.get("signals") or [])
            if "age_ambiguous" not in signals:
                signals.append("age_ambiguous")
            neutralized_safety["signals"] = signals
        if any(
            RICH_SENSITIVE_YOUNG_PATTERN.search(text)
            for text in _local_single_image_age_evidence_values(neutralized)
        ):
            raise VisualContractError(
                "local_compact sensitive fields contain unresolved young-age evidence",
                code="visual-contract-semantic-invalid",
                semantic=True,
            )
        if neutralized != structural or raw_asset_adjusted:
            return parse_visual_contract(
                json.dumps(neutralized, ensure_ascii=False),
                expected_schema=SCHEMA_VERSION_V2,
                validate_semantics=validate_semantics,
                allow_projection_redaction=allow_projection_redaction,
            )

    if not validate_semantics:
        return structural

    return parse_local_compact_visual_contract(
        raw_output,
        validate_semantics=True,
        allow_projection_redaction=allow_projection_redaction,
        allow_legacy_read=False,
        allow_young_wording_neutralization=False,
        allow_incomplete_participants=allow_incomplete_participants,
    )


def parse_local_single_image_recoverable_partial_contract(
    raw_output: str,
    *,
    expected_failure_code: str,
) -> dict:
    """Recover one exact first-pass semantic leaf without relaxing other semantics."""

    recoverable_codes = {
        "visual-contract-interaction-evidence-incomplete",
        "visual-contract-projection-redaction-required",
    }
    if expected_failure_code not in recoverable_codes:
        raise VisualContractError(
            "local single-image partial recovery code is not allowed",
            code="visual-contract-semantic-invalid",
            semantic=True,
        )

    try:
        parse_local_single_image_compact_visual_contract(
            raw_output,
            validate_semantics=True,
            allow_projection_redaction=False,
            allow_incomplete_participants=False,
        )
    except VisualContractError as strict_error:
        if (
            not strict_error.semantic
            or strict_error.code != expected_failure_code
        ):
            raise VisualContractError(
                "local single-image partial recovery strict replay mismatch",
                code="visual-contract-semantic-invalid",
                semantic=True,
            ) from strict_error
    else:
        raise VisualContractError(
            "local single-image partial recovery strict replay did not fail",
            code="visual-contract-semantic-invalid",
            semantic=True,
        )

    candidate = parse_local_single_image_compact_visual_contract(
        raw_output,
        validate_semantics=False,
        allow_projection_redaction=False,
        allow_incomplete_participants=False,
    )
    content_safety = candidate.get("content_safety") or {}
    if not (
        content_safety.get("level") in {"suggestive", "nudity", "explicit"}
        and isinstance(content_safety.get("visible_person_count"), int)
        and content_safety.get("visible_person_count") > 0
        and content_safety.get("age_assessment")
        in SENSITIVE_CANDIDATE_AGE_ASSESSMENTS
    ):
        raise VisualContractError(
            "local single-image partial recovery safety envelope is not eligible",
            code="visual-contract-semantic-invalid",
            semantic=True,
        )

    serialized = json.dumps(candidate, ensure_ascii=False)
    try:
        parse_visual_contract(
            serialized,
            expected_schema=SCHEMA_VERSION_V2,
            validate_semantics=True,
            allow_projection_redaction=False,
        )
    except VisualContractError as replay_error:
        if (
            not replay_error.semantic
            or replay_error.code != expected_failure_code
        ):
            raise VisualContractError(
                "local single-image partial recovery semantic replay mismatch",
                code="visual-contract-semantic-invalid",
                semantic=True,
            ) from replay_error
    else:
        raise VisualContractError(
            "local single-image partial recovery did not reproduce the failure",
            code="visual-contract-semantic-invalid",
            semantic=True,
        )

    if expected_failure_code == "visual-contract-projection-redaction-required":
        try:
            return parse_visual_contract(
                serialized,
                expected_schema=SCHEMA_VERSION_V2,
                validate_semantics=True,
                allow_projection_redaction=True,
            )
        except VisualContractError as projection_error:
            raise VisualContractError(
                "local single-image projection recovery has another semantic failure",
                code="visual-contract-semantic-invalid",
                semantic=True,
            ) from projection_error

    return parse_visual_contract(
        serialized,
        expected_schema=SCHEMA_VERSION_V2,
        validate_semantics=False,
    )


def _normalize_local_salient_inventory_field(
    value: Any,
    path: str,
    limit: int,
) -> str:
    if not isinstance(value, str):
        raise VisualContractError(
            f"{path} must be a string",
            code="visual-contract-salient-inventory-invalid",
        )
    if value != value.strip():
        raise VisualContractError(
            f"{path} must not contain outer whitespace",
            code="visual-contract-salient-inventory-invalid",
        )
    normalized = unicodedata.normalize("NFKC", value)
    normalized = re.sub(r"[ \t]+", " ", normalized).strip()
    if not normalized:
        raise VisualContractError(
            f"{path} must be non-empty",
            code="visual-contract-salient-inventory-invalid",
        )
    if len(normalized) > limit:
        raise VisualContractError(
            f"{path} exceeds {limit} characters",
            code="visual-contract-salient-inventory-invalid",
        )
    if any(
        unicodedata.category(character) in {"Cc", "Cf", "Cs", "Co"}
        for character in normalized
    ):
        raise VisualContractError(
            f"{path} contains unsupported control characters",
            code="visual-contract-salient-inventory-invalid",
        )
    if LOCAL_SALIENT_INVENTORY_FORBIDDEN_FIELD_CHAR_PATTERN.search(normalized):
        raise VisualContractError(
            f"{path} must be a simplified-Chinese natural phrase",
            code="visual-contract-salient-inventory-invalid",
        )
    if not LOCAL_SALIENT_INVENTORY_CJK_PATTERN.search(normalized):
        raise VisualContractError(
            f"{path} must contain simplified-Chinese text",
            code="visual-contract-salient-inventory-invalid",
        )

    scan_text = _normalize_scan_text(normalized)
    if (
        YOUNG_AGE_PATTERN.search(scan_text)
        or SAFE_SENSITIVE_PATTERN.search(scan_text)
        or DEGRADED_NON_NEUTRAL_PATTERN.search(scan_text)
    ):
        raise VisualContractError(
            f"{path} contains safety-sensitive text",
            code="visual-contract-salient-inventory-sensitive",
            semantic=True,
        )
    if LOCAL_SALIENT_INVENTORY_FORBIDDEN_TEXT_PATTERN.search(scan_text):
        raise VisualContractError(
            f"{path} contains an instruction-like phrase",
            code="visual-contract-salient-inventory-instruction",
            semantic=True,
        )
    if NON_VISIBLE_EVIDENCE_PATTERN.search(scan_text):
        raise VisualContractError(
            f"{path} must describe directly visible evidence",
            code="visual-contract-salient-inventory-invalid",
            semantic=True,
        )
    return normalized


def _validate_local_salient_inventory_category(
    key: str,
    item: dict[str, str],
    path: str,
) -> None:
    name = _normalize_scan_text(item["name"])
    appearance = _normalize_scan_text(item["appearance"])
    relation = _normalize_scan_text(item["relation"])
    combined = " ".join((name, appearance, relation))
    if key == "partial_people":
        if LOCAL_SALIENT_NONHUMAN_PERSON_PATTERN.search(combined):
            raise VisualContractError(
                f"{path} cannot classify an artifact as a partial person",
                code="visual-contract-salient-inventory-category-invalid",
                semantic=True,
            )
        if LOCAL_SALIENT_MULTI_PERSON_PATTERN.search(combined):
            raise VisualContractError(
                f"{path} must describe exactly one partial person",
                code="visual-contract-salient-inventory-safety-drift",
                semantic=True,
            )
        if (
            not LOCAL_SALIENT_PARTIAL_PERSON_PATTERN.search(name)
            and not LOCAL_SALIENT_PARTIAL_BODY_NAME_PATTERN.fullmatch(name)
        ):
            raise VisualContractError(
                f"{path}.name must identify a person",
                code="visual-contract-salient-inventory-category-invalid",
                semantic=True,
            )
        if not LOCAL_SALIENT_PARTIAL_CONTEXT_PATTERN.search(combined):
            raise VisualContractError(
                f"{path} lacks edge, occlusion, or background evidence",
                code="visual-contract-salient-inventory-category-invalid",
                semantic=True,
            )
        return
    if key == "objects":
        if LOCAL_SALIENT_FOREIGN_PARTICIPANT_PATTERN.search(combined):
            raise VisualContractError(
                f"{path} cannot introduce an uncounted participant",
                code="visual-contract-salient-inventory-safety-drift",
                semantic=True,
            )
        if LOCAL_SALIENT_FOREIGN_BODY_PART_PATTERN.search(combined):
            raise VisualContractError(
                f"{path} cannot introduce an uncounted participant body part",
                code="visual-contract-salient-inventory-safety-drift",
                semantic=True,
            )
        if (
            LOCAL_SALIENT_BODY_PART_PATTERN.search(combined)
            and not LOCAL_SALIENT_MAIN_BODY_PART_ANCHOR_PATTERN.search(combined)
        ):
            raise VisualContractError(
                f"{path} cannot introduce an unanchored body part",
                code="visual-contract-salient-inventory-safety-drift",
                semantic=True,
            )
        if LOCAL_SALIENT_GENERIC_OBJECT_PATTERN.fullmatch(name):
            raise VisualContractError(
                f"{path}.name is a generic object label",
                code="visual-contract-salient-inventory-category-invalid",
                semantic=True,
            )
        if not LOCAL_SALIENT_POSITION_RELATION_PATTERN.search(relation):
            raise VisualContractError(
                f"{path}.relation lacks a visible position or contact",
                code="visual-contract-salient-inventory-category-invalid",
                semantic=True,
            )
        return
    if key == "effects":
        if LOCAL_SALIENT_FOREIGN_PARTICIPANT_PATTERN.search(combined):
            raise VisualContractError(
                f"{path} cannot introduce an uncounted participant",
                code="visual-contract-salient-inventory-safety-drift",
                semantic=True,
            )
        if LOCAL_SALIENT_FOREIGN_BODY_PART_PATTERN.search(combined):
            raise VisualContractError(
                f"{path} cannot introduce an uncounted participant body part",
                code="visual-contract-salient-inventory-safety-drift",
                semantic=True,
            )
        if (
            LOCAL_SALIENT_BODY_PART_PATTERN.search(combined)
            and not LOCAL_SALIENT_MAIN_BODY_PART_ANCHOR_PATTERN.search(combined)
        ):
            raise VisualContractError(
                f"{path} cannot introduce an unanchored body part",
                code="visual-contract-salient-inventory-safety-drift",
                semantic=True,
            )
        if not LOCAL_SALIENT_EFFECT_PATTERN.search(f"{name} {appearance}"):
            raise VisualContractError(
                f"{path} lacks a visible effect term",
                code="visual-contract-salient-inventory-category-invalid",
                semantic=True,
            )
        if not LOCAL_SALIENT_POSITION_RELATION_PATTERN.search(relation):
            raise VisualContractError(
                f"{path}.relation lacks a visible effect position",
                code="visual-contract-salient-inventory-category-invalid",
                semantic=True,
            )


def _normalize_local_salient_inventory_mapping(value: Any) -> dict:
    if not isinstance(value, dict):
        raise VisualContractError(
            "local salient inventory must be an object",
            code="visual-contract-salient-inventory-invalid",
        )
    _require_exact_keys(
        value,
        LOCAL_SALIENT_INVENTORY_KEYS,
        "local_salient_inventory",
    )
    normalized_inventory: dict[str, list[dict[str, str]]] = {}
    for _label, key, max_items in LOCAL_SALIENT_INVENTORY_PROTOCOL:
        raw_items = value[key]
        if not isinstance(raw_items, list):
            raise VisualContractError(
                f"local_salient_inventory.{key} must be an array",
                code="visual-contract-salient-inventory-invalid",
            )
        if len(raw_items) > max_items:
            raise VisualContractError(
                f"local_salient_inventory.{key} has too many items",
                code=(
                    "visual-contract-salient-inventory-safety-drift"
                    if key == "partial_people"
                    else "visual-contract-salient-inventory-invalid"
                ),
                semantic=key == "partial_people",
            )
        items: list[dict[str, str]] = []
        seen: set[tuple[str, str, str]] = set()
        for index, raw_item in enumerate(raw_items):
            if not isinstance(raw_item, dict):
                raise VisualContractError(
                    f"local_salient_inventory.{key}[{index}] must be an object",
                    code="visual-contract-salient-inventory-invalid",
                )
            _require_exact_keys(
                raw_item,
                LOCAL_SALIENT_INVENTORY_ITEM_KEYS,
                f"local_salient_inventory.{key}[{index}]",
            )
            item = {
                field: _normalize_local_salient_inventory_field(
                    raw_item[field],
                    f"local_salient_inventory.{key}[{index}].{field}",
                    limit,
                )
                for field, limit in zip(
                    LOCAL_SALIENT_INVENTORY_ITEM_KEYS,
                    LOCAL_SALIENT_INVENTORY_FIELD_LIMITS,
                )
            }
            _validate_local_salient_inventory_category(
                key,
                item,
                f"local_salient_inventory.{key}[{index}]",
            )
            signature = tuple(
                _normalize_scan_text(item[field])
                for field in LOCAL_SALIENT_INVENTORY_ITEM_KEYS
            )
            if signature in seen:
                continue
            seen.add(signature)
            items.append(item)
        normalized_inventory[key] = items
    return normalized_inventory


def parse_local_salient_inventory(
    raw_output: str,
) -> dict[str, list[dict[str, str]]]:
    """Parse the exact three-line, non-authoritative Local salience sidecar."""

    if not isinstance(raw_output, str):
        raise VisualContractError(
            "local salient inventory output must be a string",
            code="visual-contract-salient-inventory-invalid",
        )
    if not raw_output or len(raw_output) > LOCAL_SALIENT_INVENTORY_MAX_CHARS:
        raise VisualContractError(
            "local salient inventory output is empty or oversized",
            code="visual-contract-salient-inventory-invalid",
        )
    text = raw_output.replace("\r\n", "\n")
    if "\r" in text:
        raise VisualContractError(
            "local salient inventory contains an invalid line ending",
            code="visual-contract-salient-inventory-invalid",
        )
    if text.endswith("\n"):
        text = text[:-1]
    lines = text.split("\n")
    if len(lines) != len(LOCAL_SALIENT_INVENTORY_PROTOCOL):
        raise VisualContractError(
            "local salient inventory must contain exactly three lines",
            code="visual-contract-salient-inventory-invalid",
        )

    parsed: dict[str, list[dict[str, str]]] = {}
    for line_index, ((label, key, max_items), line) in enumerate(
        zip(LOCAL_SALIENT_INVENTORY_PROTOCOL, lines)
    ):
        if len(line) > LOCAL_SALIENT_INVENTORY_MAX_LINE_CHARS:
            raise VisualContractError(
                f"local salient inventory line {line_index + 1} is oversized",
                code="visual-contract-salient-inventory-invalid",
            )
        prefix = f"{label}="
        if line.count("=") != 1 or not line.startswith(prefix):
            raise VisualContractError(
                f"local salient inventory line {line_index + 1} has an invalid prefix",
                code="visual-contract-salient-inventory-invalid",
            )
        payload = line[len(prefix):]
        if not payload:
            parsed[key] = []
            continue
        if payload.startswith(";") or payload.endswith(";") or ";;" in payload:
            raise VisualContractError(
                f"local salient inventory line {line_index + 1} has an empty item",
                code="visual-contract-salient-inventory-invalid",
            )
        raw_items = payload.split(";")
        if len(raw_items) > max_items:
            raise VisualContractError(
                f"local salient inventory line {line_index + 1} has too many items",
                code=(
                    "visual-contract-salient-inventory-safety-drift"
                    if key == "partial_people"
                    else "visual-contract-salient-inventory-invalid"
                ),
                semantic=key == "partial_people",
            )
        items: list[dict[str, str]] = []
        for item_index, raw_item in enumerate(raw_items):
            if raw_item != raw_item.strip() or raw_item.count("|") != 2:
                raise VisualContractError(
                    f"local salient inventory line {line_index + 1} item {item_index + 1} has an invalid shape",
                    code="visual-contract-salient-inventory-invalid",
                )
            fields = raw_item.split("|")
            items.append(dict(zip(LOCAL_SALIENT_INVENTORY_ITEM_KEYS, fields)))
        parsed[key] = items
    return _normalize_local_salient_inventory_mapping(parsed)


def _local_salient_inventory_relation(item: dict[str, str]) -> str:
    name = item["name"]
    relation = item["relation"]
    if _normalize_scan_text(name) in _normalize_scan_text(relation):
        return relation
    return f"{name}{relation}"


def merge_local_salient_inventory(
    raw_contract: str,
    inventory: dict[str, list[dict[str, str]]],
) -> dict:
    """Deterministically enrich a valid Local compact contract and revalidate it."""

    primary_contract = parse_local_compact_visual_contract(
        raw_contract,
        validate_semantics=True,
        allow_projection_redaction=False,
        allow_legacy_read=False,
        allow_young_wording_neutralization=False,
        allow_incomplete_participants=False,
    )
    normalized_inventory = _normalize_local_salient_inventory_mapping(inventory)
    compact = _parse_json_object(raw_contract, reject_duplicate_keys=True)
    _require_exact_keys(compact, LOCAL_COMPACT_KEYS, "local_compact")
    compact = json.loads(json.dumps(compact, ensure_ascii=False))
    entities = compact["entities"]
    relations = _compact_text_list(
        compact["relations"],
        "local_compact.relations",
        20,
        160,
    )
    added_partial_person = False

    for key, expected_kind in (
        ("partial_people", "partial_person"),
        ("objects", "object"),
        ("effects", "object"),
    ):
        for item in normalized_inventory[key]:
            normalized_name = _normalize_scan_text(item["name"])
            relation = _local_salient_inventory_relation(item)
            matching_entities = [
                entity
                for entity in entities
                if _normalize_scan_text(entity.get("name")) == normalized_name
            ]
            target = None
            if expected_kind == "partial_person":
                if any(
                    entity.get("kind") == "object"
                    for entity in matching_entities
                ):
                    raise VisualContractError(
                        f"local salient inventory kind conflicts for {item['name']}",
                        code="visual-contract-salient-inventory-conflict",
                        semantic=True,
                    )
                # A full person and a distinct edge participant may share a generic
                # name.  Only collapse an already-recorded partial person when all
                # three sidecar facts are already present; name equality alone is
                # never participant identity evidence.
                for entity in matching_entities:
                    if entity.get("kind") != "partial_person":
                        continue
                    appearance = _compact_text_list(
                        entity.get("appearance"),
                        f"local_compact.entities[{entities.index(entity)}].appearance",
                        16,
                        160,
                    )
                    if item["appearance"] in appearance and relation in relations:
                        target = entity
                        break
            else:
                target = matching_entities[0] if matching_entities else None
                if target is not None and target.get("kind") != "object":
                    raise VisualContractError(
                        f"local salient inventory kind conflicts for {item['name']}",
                        code="visual-contract-salient-inventory-conflict",
                        semantic=True,
                    )
            if target is None:
                target = {
                    "kind": expected_kind,
                    "name": item["name"],
                    "appearance": [item["appearance"]],
                    "pose": "",
                    "action": "",
                    "materials": [],
                    "colors": [],
                }
                entities.append(target)
                if expected_kind == "partial_person":
                    added_partial_person = True
            elif expected_kind == "object":
                appearance = _compact_text_list(
                    target.get("appearance"),
                    f"local_compact.entities[{entities.index(target)}].appearance",
                    16,
                    160,
                )
                if item["appearance"] not in appearance:
                    appearance.append(item["appearance"])
                target["appearance"] = appearance

            if relation not in relations:
                relations.append(relation)

    if len(entities) > _MAX_ENTITIES:
        raise VisualContractError(
            "local salient inventory would exceed the entity limit",
            code="visual-contract-salient-inventory-invalid",
            semantic=True,
        )
    people = sum(
        entity.get("kind") in {"person", "partial_person"}
        for entity in entities
    )
    if people > 3:
        raise VisualContractError(
            "local salient inventory would exceed the participant limit",
            code="visual-contract-salient-inventory-safety-drift",
            semantic=True,
        )
    compact["people"] = people
    compact["entities"] = entities
    compact["relations"] = relations
    if added_partial_person and compact.get("age") in {
        "adult_appearing",
        "not_applicable",
    }:
        compact["age"] = "age_unverifiable"

    merged_contract = parse_local_compact_visual_contract(
        json.dumps(compact, ensure_ascii=False, separators=(",", ":")),
        validate_semantics=True,
        allow_projection_redaction=False,
        allow_legacy_read=False,
        allow_young_wording_neutralization=False,
        allow_incomplete_participants=False,
    )
    primary_safety = primary_contract["content_safety"]
    merged_safety = merged_contract["content_safety"]
    for key in ("level", "body_exposure", "interaction_category"):
        if merged_safety[key] != primary_safety[key]:
            raise VisualContractError(
                "local salient inventory cannot modify primary safety fields",
                code="visual-contract-salient-inventory-safety-drift",
                semantic=True,
            )
    expected_age = primary_safety["age_assessment"]
    if added_partial_person and expected_age in {
        "adult_appearing",
        "not_applicable",
    }:
        expected_age = "age_unverifiable"
    if (
        merged_safety["age_assessment"] != expected_age
        or merged_safety["visible_person_count"] != people
    ):
        raise VisualContractError(
            "local salient inventory age or participant count drifted",
            code="visual-contract-salient-inventory-safety-drift",
            semantic=True,
        )
    if not set(primary_safety["signals"]).issubset(merged_safety["signals"]):
        raise VisualContractError(
            "local salient inventory cannot remove primary safety signals",
            code="visual-contract-salient-inventory-safety-drift",
            semantic=True,
        )
    if (
        merged_safety["sensitive_visible_facts"]
        != primary_safety["sensitive_visible_facts"]
    ):
        raise VisualContractError(
            "local salient inventory cannot modify primary sensitive facts",
            code="visual-contract-salient-inventory-safety-drift",
            semantic=True,
        )
    return merged_contract


def _local_static_compact_list(value: Any, path: str, expected_length: int) -> list:
    if not isinstance(value, list):
        raise VisualContractError(f"{path} must be an array")
    if len(value) != expected_length:
        raise VisualContractError(
            f"{path} must contain exactly {expected_length} items"
        )
    return value


def _local_static_compact_group(
    value: Any,
    path: str,
    keys: tuple[str, ...],
) -> list:
    if isinstance(value, dict):
        _require_exact_keys(value, keys, path)
        return [value[key] for key in keys]
    return _local_static_compact_list(value, path, len(keys))


def _local_static_compact_scene_group(value: Any) -> list:
    if isinstance(value, str):
        return [value, "", []]
    return _local_static_compact_group(
        value,
        "local_static_compact.n2[8]",
        SCENE_KEYS,
    )


def _local_static_compact_look_group(value: Any) -> list:
    if isinstance(value, str):
        return [[], [], [], value, "", ""]
    if (
        isinstance(value, list)
        and len(value) != len(LOOK_KEYS)
        and len(value) <= 12
        and all(isinstance(item, str) for item in value)
    ):
        return [[], [], [], value, "", ""]
    return _local_static_compact_group(
        value,
        "local_static_compact.n2[9]",
        LOOK_KEYS,
    )


def _local_static_compact_camera_group(value: Any) -> list:
    if isinstance(value, str):
        return ["", "", value, ""]
    return _local_static_compact_group(
        value,
        "local_static_compact.n2[10]",
        CAMERA_KEYS,
    )


def _local_static_compact_code(value: Any, mapping: dict, path: str) -> str:
    if isinstance(value, str):
        if value in mapping.values():
            return value
        string_codes = {str(code): label for code, label in mapping.items()}
        if value in string_codes:
            return string_codes[value]
    if isinstance(value, bool) or not isinstance(value, int) or value not in mapping:
        raise VisualContractError(f"{path} has unsupported code")
    return mapping[value]


def _local_static_compact_count(value: Any, path: str) -> int:
    if isinstance(value, str):
        string_counts = {str(count): count for count in range(4)}
        if value in string_counts:
            return string_counts[value]
    if isinstance(value, bool) or not isinstance(value, int) or value not in range(4):
        raise VisualContractError(f"{path} must be an integer from 0 to 3")
    return value


def _local_static_compact_asset(value: Any, people: int) -> Any:
    if not isinstance(value, str) or value.strip():
        return value
    return "人物参考图" if people > 0 else "物体参考图"


def _decode_local_static_compact_contract(root: dict) -> dict:
    _require_exact_keys(root, LOCAL_STATIC_COMPACT_ROOT_KEYS, "local_static_compact")
    values = _local_static_compact_list(
        root["n2"],
        "local_static_compact.n2",
        LOCAL_STATIC_COMPACT_FIELD_COUNT,
    )
    people = _local_static_compact_count(
        values[5], "local_static_compact.n2[5]"
    )
    raw_entities = values[6]
    if not isinstance(raw_entities, list):
        raise VisualContractError("local_static_compact.n2[6] must be an array")
    if len(raw_entities) > 4:
        raise VisualContractError(
            "local_static_compact.n2[6] has too many entities"
        )
    entities = []
    for index, raw_entity in enumerate(raw_entities):
        entity = _local_static_compact_list(
            raw_entity,
            f"local_static_compact.n2[6][{index}]",
            LOCAL_STATIC_COMPACT_ENTITY_FIELD_COUNT,
        )
        entities.append({
            "kind": _local_static_compact_code(
                entity[0],
                LOCAL_STATIC_COMPACT_ENTITY_KIND_CODES,
                f"local_static_compact.n2[6][{index}][0]",
            ),
            "name": entity[1],
            "appearance": entity[2],
            "pose": entity[3],
            "action": entity[4],
            "materials": entity[5],
            "colors": entity[6],
        })

    scene = _local_static_compact_scene_group(values[8])
    look = _local_static_compact_look_group(values[9])
    camera = _local_static_compact_camera_group(values[10])
    raw_signal_codes = values[11]
    if isinstance(raw_signal_codes, str):
        raw_signal_codes = [
            item
            for item in re.split(r"[,，|/\s]+", raw_signal_codes.strip())
            if item
        ]
    if not isinstance(raw_signal_codes, list):
        raise VisualContractError("local_static_compact.n2[11] must be an array")
    if len(raw_signal_codes) > len(LOCAL_STATIC_COMPACT_SIGNAL_CODES):
        raise VisualContractError(
            "local_static_compact.n2[11] has too many signal codes"
        )
    signals = []
    for index, code in enumerate(raw_signal_codes):
        if not isinstance(code, str) or (
            code not in LOCAL_STATIC_COMPACT_SIGNAL_CODES
            and code not in LOCAL_STATIC_COMPACT_SIGNAL_CODES.values()
        ):
            raise VisualContractError(
                f"local_static_compact.n2[11][{index}] has unsupported code"
            )
        signal = LOCAL_STATIC_COMPACT_SIGNAL_CODES.get(code, code)
        if signal in signals:
            raise VisualContractError(
                f"local_static_compact.n2[11][{index}] duplicates a signal code"
            )
        signals.append(signal)

    return {
        "asset": _local_static_compact_asset(values[0], people),
        "level": _local_static_compact_code(
            values[1], LOCAL_STATIC_COMPACT_LEVEL_CODES, "local_static_compact.n2[1]"
        ),
        "body": _local_static_compact_code(
            values[2], LOCAL_STATIC_COMPACT_BODY_CODES, "local_static_compact.n2[2]"
        ),
        "interaction": _local_static_compact_code(
            values[3],
            LOCAL_STATIC_COMPACT_INTERACTION_CODES,
            "local_static_compact.n2[3]",
        ),
        "age": _local_static_compact_code(
            values[4], LOCAL_STATIC_COMPACT_AGE_CODES, "local_static_compact.n2[4]"
        ),
        "people": people,
        "entities": entities,
        "relations": values[7],
        "scene": {
            "environment": scene[0],
            "background": scene[1],
            "spatial_layers": scene[2],
        },
        "look": {
            "lighting": look[0],
            "palette": look[1],
            "materials": look[2],
            "style": look[3],
            "atmosphere": look[4],
            "finish": look[5],
        },
        "camera": {
            "shot": camera[0],
            "angle": camera[1],
            "composition": camera[2],
            "depth_of_field": camera[3],
        },
        "signals": signals,
        "facts": values[12],
    }


def parse_local_static_compact_visual_contract(
    raw_output: str,
    *,
    validate_semantics: bool = True,
    allow_projection_redaction: bool = False,
    allow_incomplete_participants: bool = False,
    allow_legacy_read: bool = True,
) -> dict:
    """Parse the ordinary single-image tuple IR while retaining old compact reads."""

    root = _parse_json_object(raw_output, reject_duplicate_keys=True)
    if set(root) != set(LOCAL_STATIC_COMPACT_ROOT_KEYS):
        if not allow_legacy_read:
            _require_exact_keys(
                root,
                LOCAL_STATIC_COMPACT_ROOT_KEYS,
                "local_static_compact",
            )
        return parse_local_compact_visual_contract(
            raw_output,
            validate_semantics=validate_semantics,
            allow_projection_redaction=allow_projection_redaction,
        )
    compact = _decode_local_static_compact_contract(root)
    if (
        validate_semantics
        and compact["level"] != "safe"
        and compact["age"] != "young_or_minor_indicators"
        and any(
            YOUNG_AGE_PATTERN.search(text)
            for text in _scan_text_values(compact)
        )
    ):
        raise VisualContractError(
            "local_static_compact young wording requires young_or_minor_indicators",
            code="visual-contract-semantic-invalid",
            semantic=True,
        )
    if allow_incomplete_participants:
        if validate_semantics:
            raise ValueError(
                "allow_incomplete_participants requires validate_semantics=False"
            )
        people = compact["people"]
        person_entity_count = sum(
            entity["kind"] in {"person", "partial_person"}
            for entity in compact["entities"]
        )
        if person_entity_count > people:
            raise VisualContractError(
                "local_static_compact cannot safely reduce extra participant entities",
                code="visual-contract-semantic-invalid",
                semantic=True,
            )
        for _index in range(people - person_entity_count):
            compact["entities"].append({
                "kind": "partial_person",
                "name": "未完整分析的可见人物",
                "appearance": [],
                "pose": "",
                "action": "",
                "materials": [],
                "colors": [],
            })
    return parse_local_compact_visual_contract(
        json.dumps(compact, ensure_ascii=False, separators=(",", ":")),
        validate_semantics=validate_semantics,
        allow_projection_redaction=allow_projection_redaction,
    )


def parse_visual_contract(
    raw_output: str,
    expected_schema: str | None = None,
    *,
    validate_semantics: bool = True,
    allow_projection_redaction: bool = False,
) -> dict:
    """Parse and normalize an exact nf.visual.v1 or nf.visual.v2 response."""

    parsed = _parse_json_object(raw_output)
    schema = parsed.get("schema")
    if schema == SCHEMA_VERSION_V1:
        top_level_keys = TOP_LEVEL_KEYS_V1
    elif schema == SCHEMA_VERSION_V2:
        top_level_keys = TOP_LEVEL_KEYS_V2
    else:
        raise VisualContractError(
            f"schema must be {SCHEMA_VERSION_V1} or {SCHEMA_VERSION_V2}"
        )
    _require_exact_keys(parsed, top_level_keys, "root")
    if expected_schema and schema != expected_schema:
        raise VisualContractError(f"schema must be {expected_schema}")

    asset_type = _nullable_text(parsed["asset_type"], "asset_type", 40)
    if not asset_type:
        raise VisualContractError("asset_type must be a non-empty Chinese asset type")

    entities_value = parsed["entities"]
    if not isinstance(entities_value, list):
        raise VisualContractError("entities must be an array")
    if len(entities_value) > _MAX_ENTITIES:
        raise VisualContractError("entities has too many items")
    entities: list[dict] = []
    for index, raw_entity in enumerate(entities_value):
        entity = _require_object(raw_entity, f"entities[{index}]")
        _require_exact_keys(entity, ENTITY_KEYS, f"entities[{index}]")
        count = _nullable_text(entity["count"], f"entities[{index}].count", 40)
        entities.append({
            "name": _nullable_text(entity["name"], f"entities[{index}].name", 120),
            "count": count,
            "appearance": _text_list(entity["appearance"], f"entities[{index}].appearance", 16, 160),
            "pose": _nullable_text(entity["pose"], f"entities[{index}].pose", 120),
            "action": _nullable_text(entity["action"], f"entities[{index}].action", 160),
            "materials": _text_list(entity["materials"], f"entities[{index}].materials", 12, 100),
            "colors": _text_list(entity["colors"], f"entities[{index}].colors", 12, 100),
        })

    scene = _require_object(parsed["scene"], "scene")
    _require_exact_keys(scene, SCENE_KEYS, "scene")
    normalized_scene = {
        "environment": _nullable_text(scene["environment"], "scene.environment", 200),
        "background": _nullable_text(scene["background"], "scene.background", 200),
        "spatial_layers": _text_list(scene["spatial_layers"], "scene.spatial_layers", 12, 160),
    }

    look = _require_object(parsed["look"], "look")
    _require_exact_keys(look, LOOK_KEYS, "look")
    normalized_look = {
        "lighting": _text_list(look["lighting"], "look.lighting", 12, 120),
        "palette": _text_list(look["palette"], "look.palette", 12, 100),
        "materials": _text_list(look["materials"], "look.materials", 12, 100),
        "style": _text_list(look["style"], "look.style", 12, 120),
        "atmosphere": _nullable_text(look["atmosphere"], "look.atmosphere", 120),
        "finish": _nullable_text(look["finish"], "look.finish", 120),
    }

    camera = _require_object(parsed["camera_cues"], "camera_cues")
    _require_exact_keys(camera, CAMERA_KEYS, "camera_cues")
    normalized_camera = {
        "shot": _nullable_text(camera["shot"], "camera_cues.shot", 100),
        "angle": _nullable_text(camera["angle"], "camera_cues.angle", 100),
        "composition": _nullable_text(camera["composition"], "camera_cues.composition", 160),
        "depth_of_field": _nullable_text(camera["depth_of_field"], "camera_cues.depth_of_field", 100),
    }

    normalized = {
        "schema": schema,
        "asset_type": asset_type,
        "entities": entities,
        "relations": _text_list(parsed["relations"], "relations", 20, 160),
        "scene": normalized_scene,
        "look": normalized_look,
        "camera_cues": normalized_camera,
        "ocr": _text_list(parsed["ocr"], "ocr", 16, 160),
        "uncertain": _text_list(parsed["uncertain"], "uncertain", 20, 160),
    }

    if schema == SCHEMA_VERSION_V2:
        content_safety = _require_object(parsed["content_safety"], "content_safety")
        _require_exact_keys(content_safety, CONTENT_SAFETY_KEYS, "content_safety")
        enum_text = (
            _enum_text
            if validate_semantics
            else lambda value, _allowed, path: _required_text(value, path, 80)
        )
        normalized["content_safety"] = {
            "level": enum_text(content_safety["level"], CONTENT_LEVELS, "content_safety.level"),
            "body_exposure": enum_text(
                content_safety["body_exposure"], BODY_EXPOSURES, "content_safety.body_exposure"
            ),
            "interaction_category": enum_text(
                content_safety["interaction_category"],
                INTERACTION_CATEGORIES,
                "content_safety.interaction_category",
            ),
            "age_assessment": enum_text(
                content_safety["age_assessment"], AGE_ASSESSMENTS, "content_safety.age_assessment"
            ),
            "visible_person_count": _bounded_int(
                content_safety["visible_person_count"], "content_safety.visible_person_count", 0, 12
            ),
            "signals": (
                _enum_list(content_safety["signals"], CONTENT_SIGNALS, "content_safety.signals", 8)
                if validate_semantics
                else _text_list(content_safety["signals"], "content_safety.signals", 16, 80)
            ),
            "sensitive_visible_facts": _text_list(
                content_safety["sensitive_visible_facts"],
                "content_safety.sensitive_visible_facts",
                6,
                160,
            ),
        }
        if validate_semantics:
            _validate_v2_semantics(
                normalized,
                allow_projection_redaction=allow_projection_redaction,
            )

    return normalized


def _semantic_error(message: str) -> None:
    raise VisualContractError(
        message,
        code="visual-contract-semantic-invalid",
        semantic=True,
    )


def _interaction_evidence_error(message: str) -> None:
    raise VisualContractError(
        message,
        code="visual-contract-interaction-evidence-incomplete",
        semantic=True,
    )


def _projection_redaction_error(message: str) -> None:
    raise VisualContractError(
        message,
        code="visual-contract-projection-redaction-required",
        semantic=True,
    )


def _validate_v2_semantics(
    contract: dict,
    *,
    allow_projection_redaction: bool = False,
) -> None:
    content_safety = contract["content_safety"]
    level = content_safety["level"]
    body_exposure = content_safety["body_exposure"]
    interaction_category = content_safety["interaction_category"]
    age_assessment = content_safety["age_assessment"]
    person_count = content_safety["visible_person_count"]
    signals = set(content_safety["signals"])
    sensitive_facts = content_safety["sensitive_visible_facts"]
    projection_redaction_required = False

    if level == "safe":
        if body_exposure != "none" or interaction_category != "none":
            _semantic_error("safe level requires body_exposure=none and interaction_category=none")
        if signals:
            _semantic_error("safe level requires empty signals")
        if sensitive_facts:
            _semantic_error("safe level requires empty sensitive_visible_facts")
        ordinary_visual_fields = {
            key: value for key, value in contract.items() if key != "content_safety"
        }
        if any(
            SAFE_SENSITIVE_PATTERN.search(text)
            for text in _scan_text_values(ordinary_visual_fields)
        ):
            _semantic_error("safe level contains explicit sensitive semantics in visual fields")
    else:
        projection_safe_fields = {
            "asset_type": contract["asset_type"],
            "entities": [
                {
                    **{
                        key: entity[key]
                        for key in SAFE_PROJECTION_ENTITY_KEYS
                    },
                    "pose": _safe_projection_pose(entity["pose"]),
                }
                for entity in contract["entities"]
            ],
            "scene": contract["scene"],
            "camera_cues": contract["camera_cues"],
            "ocr": contract["ocr"],
            "look": {
                key: contract["look"][key]
                for key in SAFE_PROJECTION_LOOK_KEYS
            },
        }
        projection_redaction_required = any(
            SAFE_SENSITIVE_PATTERN.search(text)
            for text in _scan_text_values(projection_safe_fields)
        )
    if level == "uncertain" and sensitive_facts:
        _semantic_error("uncertain level requires empty sensitive_visible_facts")
    if body_exposure in {"partial", "full"} and "nudity" not in signals:
        _semantic_error("partial or full body exposure requires nudity signal")
    if body_exposure == "none" and "nudity" in signals:
        _semantic_error("body_exposure=none cannot include nudity signal")
    if interaction_category == "sexual" and "explicit_activity" not in signals:
        _semantic_error("sexual interaction requires explicit_activity signal")
    if "explicit_activity" in signals and interaction_category == "none":
        _semantic_error("explicit_activity signal requires a non-none interaction")
    if level == "suggestive" and (
        body_exposure == "full" or interaction_category == "sexual"
    ):
        _semantic_error("suggestive level cannot use full exposure or sexual interaction")
    if level == "nudity" and interaction_category == "sexual":
        _semantic_error("nudity level cannot use sexual interaction")
    if level in {"suggestive", "nudity"} and signals & EXPLICIT_SIGNALS:
        _semantic_error("suggestive or nudity level cannot include explicit signals")
    if level == "explicit" and not (
        interaction_category == "sexual" or signals & EXPLICIT_SIGNALS
    ):
        _semantic_error("explicit level requires a sexual or explicit signal")
    if level in {"suggestive", "nudity", "explicit"} and not sensitive_facts:
        _semantic_error("sensitive content level requires sensitive_visible_facts")
    if interaction_category != "none" and not (
        contract["relations"] or any(entity["action"] for entity in contract["entities"])
    ):
        _semantic_error("non-none interaction requires relations or entity.action")
    if person_count > 0 and len(contract["entities"]) < person_count:
        _semantic_error("entities must cover visible_person_count")
    if person_count == 0 and age_assessment != "not_applicable":
        _semantic_error("zero visible_person_count requires age_assessment=not_applicable")
    if person_count == 0 and level != "safe":
        if body_exposure != "none" or interaction_category != "none":
            _semantic_error(
                "zero visible_person_count requires body_exposure=none and interaction_category=none"
            )
        if signals & ZERO_PERSON_FORBIDDEN_SIGNALS:
            _semantic_error("zero visible_person_count contains person-only content signals")
        ordinary_visual_fields = {
            key: value for key, value in contract.items() if key != "content_safety"
        }
        zero_person_fields = {
            "ordinary": ordinary_visual_fields,
            "sensitive_visible_facts": sensitive_facts,
        }
        entity_names = [
            _normalize_scan_text(entity["name"])
            for entity in contract["entities"]
        ]
        normalized_facts = [
            _normalize_scan_text(fact)
            for fact in sensitive_facts
            if _normalize_scan_text(fact)
        ]
        if any(entity["pose"] or entity["action"] for entity in contract["entities"]):
            _semantic_error("zero visible_person_count requires object entities without pose or action")
        if any(
            ZERO_PERSON_HUMAN_COUNT_PATTERN.search(_normalize_scan_text(entity["count"]))
            for entity in contract["entities"]
            if entity["count"]
        ):
            _semantic_error("zero visible_person_count cannot use person-count units")
        if entity_names and any(
            not name or not ZERO_PERSON_OBJECT_PATTERN.search(name) for name in entity_names
        ):
            _semantic_error("zero visible_person_count requires object-only entity names")
        if normalized_facts and any(
            not ZERO_PERSON_OBJECT_PATTERN.search(fact) for fact in normalized_facts
        ):
            _semantic_error("zero visible_person_count requires object-only sensitive facts")
        object_evidence = [
            _normalize_scan_text(contract["asset_type"]),
            *entity_names,
            *normalized_facts,
        ]
        if not any(ZERO_PERSON_OBJECT_PATTERN.search(text) for text in object_evidence):
            _semantic_error("zero visible_person_count requires explicit object-only evidence")
        if PERSON_ASSET_TYPE_PATTERN.fullmatch(_normalize_scan_text(contract["asset_type"])) or any(
            VISIBLE_PERSON_PATTERN.search(text)
            or ZERO_PERSON_GENDER_SUBJECT_PATTERN.search(text)
            for text in _scan_text_values(zero_person_fields)
        ):
            _semantic_error("zero visible_person_count conflicts with visible person semantics")
    if person_count > 0 and age_assessment == "not_applicable":
        _semantic_error("positive visible_person_count requires an applicable age_assessment")
    if level == "nudity" and body_exposure == "none":
        _semantic_error("nudity level cannot use body_exposure=none")
    if (
        level != "safe"
        and age_assessment in AGE_ASSESSMENTS_REQUIRING_AMBIGUOUS_SIGNAL
        and "age_ambiguous" not in signals
    ):
        _semantic_error("ambiguous age assessment requires age_ambiguous signal")
    if (
        level != "safe"
        and "age_ambiguous" in signals
        and age_assessment not in AGE_ASSESSMENTS_REQUIRING_AMBIGUOUS_SIGNAL
    ):
        _semantic_error("age_ambiguous signal requires ambiguous age assessment")
    if level != "safe":
        ordinary_visual_fields = {
            key: value for key, value in contract.items() if key != "content_safety"
        }
        if any(
            YOUNG_AGE_PATTERN.search(text)
            for text in _scan_text_values(ordinary_visual_fields)
        ):
            _semantic_error(
                "non-safe content requires neutral adult-or-ambiguous wording in ordinary visual fields"
            )
        if (
            age_assessment != "young_or_minor_indicators"
            and any(
                YOUNG_AGE_PATTERN.search(text)
                for text in _scan_text_values(sensitive_facts)
            )
        ):
            _semantic_error("non-young age assessment cannot contain young indicators")
    if projection_redaction_required and not allow_projection_redaction:
        _projection_redaction_error(
            "projection-safe fields cannot contain explicit sensitive semantics"
        )
    if interaction_category == "sexual" or "explicit_activity" in signals:
        interaction_relation_text = _normalize_scan_text("；".join([
            *contract["relations"],
            *(entity["action"] for entity in contract["entities"] if entity["action"]),
        ]))
        sensitive_fact_text = _normalize_scan_text("；".join(sensitive_facts))
        if not (
            INTERACTION_RELATION_EVIDENCE_PATTERN.search(interaction_relation_text)
            and _has_concrete_interaction_action(interaction_relation_text)
            and SAFE_SENSITIVE_PATTERN.search(sensitive_fact_text)
            and not NON_VISIBLE_EVIDENCE_PATTERN.search(sensitive_fact_text)
            and _has_concrete_interaction_action(sensitive_fact_text)
        ):
            _interaction_evidence_error(
                "sexual or explicit activity requires detailed sensitive interaction evidence"
            )


def empty_visual_contract(schema_version: str = SCHEMA_VERSION_V1) -> dict:
    if schema_version not in {SCHEMA_VERSION_V1, SCHEMA_VERSION_V2}:
        raise ValueError(f"unsupported visual schema: {schema_version}")
    contract = {
        "schema": schema_version,
        "asset_type": "通用",
        "entities": [],
        "relations": [],
        "scene": {"environment": None, "background": None, "spatial_layers": []},
        "look": {"lighting": [], "palette": [], "materials": [], "style": [], "atmosphere": None, "finish": None},
        "camera_cues": {"shot": None, "angle": None, "composition": None, "depth_of_field": None},
        "ocr": [],
        "uncertain": [],
    }
    if schema_version == SCHEMA_VERSION_V2:
        contract["content_safety"] = {
            "level": "safe",
            "body_exposure": "none",
            "interaction_category": "none",
            "age_assessment": "not_applicable",
            "visible_person_count": 0,
            "signals": [],
            "sensitive_visible_facts": [],
        }
    return contract


def visual_contract_instruction(
    schema_version: str = SCHEMA_VERSION_V1,
    semantic_retry: str = "",
) -> str:
    canonical = empty_visual_contract(schema_version)
    entities = [{
        "name": "",
        "count": None,
        "appearance": [],
        "pose": None,
        "action": None,
        "materials": [],
        "colors": [],
    }]
    # Qwen3-VL is materially more reliable when the potentially long entity
    # list is emitted last. The normalized contract keeps the canonical keys.
    example = {
        "schema": canonical["schema"],
        "asset_type": canonical["asset_type"],
        "relations": canonical["relations"],
        "scene": canonical["scene"],
        "look": canonical["look"],
        "camera_cues": canonical["camera_cues"],
        "ocr": canonical["ocr"],
        "uncertain": canonical["uncertain"],
    }
    if schema_version == SCHEMA_VERSION_V2:
        example["content_safety"] = canonical["content_safety"]
    example["entities"] = entities
    v2_instruction = (
        "content_safety只做直接可见内容的高层分类，字段必须完整且不得增加字段："
        "level只允许safe、suggestive、nudity、explicit、uncertain；"
        "body_exposure只允许none、partial、full、uncertain；"
        "interaction_category只允许none、intimate、sexual、uncertain；"
        "age_assessment的新输出只允许adult_appearing、age_unverifiable、young_or_minor_indicators、not_applicable；"
        "ambiguous_or_young_appearing仅供历史数据兼容读取，本次不得输出。"
        "adult_appearing表示画面可见外观明确成年化且没有年轻化证据；"
        "age_unverifiable表示没有可见年轻化证据但仅凭图片无法确认成年；"
        "young_or_minor_indicators表示存在可见的年轻化或未成年特征；不得猜测精确年龄。"
        "visible_person_count填写画面中直接可见的人数0到12；人数为0时age_assessment必须为not_applicable，"
        "人数大于0时不得使用not_applicable；人数为0时body_exposure与interaction_category必须为none，"
        "signals不得含nudity、sexualized_pose、explicit_activity或age_ambiguous，且asset_type、普通视觉事实与敏感事实"
        "均不得描述可见人物或人物角色；非safe的0人内容必须明确为道具、物体、用品或产品等object-only主体，"
        "entity.name与敏感事实都要包含对象类别，pose与action必须为空，count不得使用名或位等人物量词；"
        "人物名词与prop、object、product等对象词混写仍属于人物冲突，不得据此把可见人物计为0；"
        "signals只允许nudity、sexualized_pose、explicit_activity、explicit_anatomy、sexual_fluid、age_ambiguous，去重后最多8项；"
        "sensitive_visible_facts最多6个直接可见的简短事实，level为suggestive、nudity或explicit时至少填写1项；"
        "level为safe时body_exposure与interaction_category必须为none且signals与sensitive_visible_facts必须为空；"
        "level为uncertain时sensitive_visible_facts必须为空；body_exposure为partial或full时signals必须含nudity，"
        "body_exposure为none时signals不得含nudity；interaction_category为sexual时signals必须含explicit_activity，"
        "signals含explicit_activity时interaction_category不得为none；suggestive不得使用full或sexual，nudity不得使用sexual。"
        "suggestive和nudity不得携带explicit_activity、explicit_anatomy或sexual_fluid；这些强显式signals应使用explicit，"
        "uncertain仍按事实为空且强制安全投影处理。"
        "每个可见人物必须拆成独立entity，不得把重叠人物合并；"
        "interaction_category非none时必须在relations或entity.action中记录对应的可见互动。"
        "interaction_category为sexual或signals包含explicit_activity时，不得只写成人互动、性行为等标签；"
        "relations或entity.action必须写明参与者或身体部位之间的空间或接触关系，"
        "sensitive_visible_facts必须同时写明直接可见的具体敏感动作或接触状态；不强制复述‘直接可见’四字，但事实本身必须具体。"
        "无可见年轻化证据但仅凭画面无法确认成年时，age_assessment必须填写age_unverifiable；"
        "只有可见外观明确成年化且没有年轻化证据时才填写adult_appearing。"
        "level非safe时，asset_type、entity、relations、scene、look、camera_cues、ocr和uncertain等普通视觉字段"
        "必须使用人物、女性角色、男性角色等中性称呼，不得使用少女、少年、女孩、男孩、幼女、萝莉、正太、未成年、"
        "儿童、loli、shota、child、teen、girl、boy、minor、underage等年轻化或未成年词。"
        "只有age_assessment为young_or_minor_indicators时，sensitive_visible_facts才允许客观记录图片直接可见的年轻化证据；"
        "其他age_assessment的sensitive_visible_facts也不得包含这些词。"
        "level为safe时，普通视觉字段不得夹带明确裸露、性行为、显式解剖、性体液或色情语义；存在这些事实必须选择对应非safe层级。"
        "level非safe时，asset_type、entity的name、count、appearance、colors、scene、camera_cues、ocr以及"
        "look中的lighting、palette、style、atmosphere、finish不得夹带这些敏感事实；"
        "entity.pose只有自然站立、站姿、坐姿、平躺、仰卧、俯卧、侧躺等粗粒度姿态可用于安全投影；"
        "敏感事实只能写入sensitive_visible_facts，避免安全投影泄漏。"
        "age_assessment为age_unverifiable或young_or_minor_indicators且level非safe时signals必须含age_ambiguous；"
        "非safe的signals含age_ambiguous时age_assessment必须为age_unverifiable或young_or_minor_indicators；"
        "safe普通人物图不要求此signal。"
        if schema_version == SCHEMA_VERSION_V2
        else ""
    )
    interaction_retry_instruction = (
        "本次只修正互动证据：relations或entity.action必须同时写出关系两端和具体接触动作，"
        "sensitive_visible_facts也必须写出敏感对象与具体动作。只使用以下占位句式模板确定字段结构："
        "relations=[\"[参与者或身体部位A][空间或接触关系][参与者或身体部位B]\"]，"
        "entity.action=\"[参与者或身体部位A][具体动作][参与者或身体部位B]\"，"
        "sensitive_visible_facts=[\"[敏感对象或身体部位A][具体动作或接触状态][对象或身体部位B]\"]。"
        "所有方括号占位符都必须替换为图片中真实可见的参与者、身体部位、关系和动作；"
        "不得原样输出任何方括号，不得把模板本身当作图片事实。"
        if "requires detailed sensitive interaction evidence" in str(semantic_retry or "")
        else ""
    )
    retry_instruction = (
        f"上次输出未通过视觉合同门禁：{_clean_text(semantic_retry, 240)}。"
        "重新观察图片，只返回一个单一、完整、合法的JSON对象；严格使用示例中的顶层和嵌套exact keys，"
        f"不要Markdown、解释、前后缀或额外字段，并修正不一致的字段值。{interaction_retry_instruction}"
        if semantic_retry
        else ""
    )
    entity_limit = 12 if schema_version == SCHEMA_VERSION_V2 else 8
    return (
        "只提取图片中直接可见的视觉事实，不做内容审查，不省略可见主体，也不得猜测被遮挡或无法确认的细节。"
        "未知标量使用空字符串或null，未知列表使用空数组；存在多种可能时写入uncertain。"
        "只输出一个合法JSON对象，不要Markdown、解释、前后缀或模型信息。"
        "字段值使用中文。顶层及嵌套字段必须完整且不得增加其他字段；顶层键严格按示例顺序输出，entities必须最后输出。严格结构为："
        f"{json.dumps(example, ensure_ascii=False, separators=(',', ':'))}"
        "。asset_type填写角色、场景、UI、道具、特效、海报、摄影或其他可见资产类型；"
        f"输出保持紧凑：{'总输出不超过1000个中文字符；' if schema_version == SCHEMA_VERSION_V2 else ''}entities最多{entity_limit}项，相同或重复的小物合并描述；每个实体的appearance、materials、colors各最多6个短语，"
        "relations、spatial_layers以及look内各数组最多8项，不得用完整句反复描述同一事实；"
        "entities逐个记录主体名称、数量、外观、姿势、动作、材质与颜色；count使用中文数量字符串，例如一名、两个或三把；"
        "relations记录主体之间以及主体与物体之间的可见空间或接触关系；"
        "scene记录环境、背景和前中后空间层次；look记录光线、色板、全局材质、风格、氛围和完成质感；"
        "camera_cues只记录可观察的景别、视角、构图和景深表现，不推断焦距、光圈、ISO或相机型号；"
        "ocr只记录确实可辨认的画面文字。"
        f"{v2_instruction}{retry_instruction}"
    )


def rich_visual_prompt_instruction(*, sensitive: bool = False) -> str:
    sensitive_instruction = (
        "该图片包含敏感可见内容。所有人物必须明确使用成年女性、成年男性、成年角色或成年人物称呼，"
        "不得使用少女、女孩、少年、男孩、年轻、girl、boy、young、teen、loli、shota等年轻化或未成年词。"
        if sensitive
        else ""
    )
    return (
        "重新直接观察当前图片，生成可直接用于图像生成的高密度中文最终提示词。"
        "只描述图片中直接可见的事实；不得猜测身份、意图、画外内容、被遮挡细节或不可确认参数。"
        "只允许按以下顺序输出五个且仅五个TOML风格section：[风格设定]、[主体物品]、[环境背景]、"
        "[光线与色彩]、[拍摄参数]。每个section必须有具体内容，不得增加其他section。"
        "section内使用清晰的中文键值行或数组逐项记录，不要输出Markdown代码围栏、JSON、标题、前言、总结、注释或解释。"
        "[风格设定]完整记录媒介、绘画或渲染语言、氛围和完成质感；"
        "[主体物品]逐个记录可见主体与物品的数量、外观构成、局部形态、姿势、动作、材质、颜色，"
        "并逐项写清主体、身体部位与物体之间直接可见的空间、遮挡和接触关系；"
        "[环境背景]记录环境、背景、前中后景、承托面和遮挡层次；"
        "[光线与色彩]记录光源方向、软硬、明暗、轮廓光、主辅色和局部颜色；"
        "[拍摄参数]只记录可观察的景别、视角、构图、裁切、透视和景深，不推断焦距、光圈、ISO或相机型号。"
        "在不猜测和不重复的前提下逐项保留可见细节；最终正文控制在400至600个中文字符，"
        "其中[主体物品]优先分配篇幅，其余section保持紧凑但不得为空。"
        "不要输出[用户附加要求]，该section由系统在模型输出通过校验后确定性追加。"
        f"{sensitive_instruction}"
    )


def validate_rich_visual_prompt(
    raw_output: str,
    *,
    sensitive: bool = False,
    require_interaction_evidence: bool = False,
    minimum_body_chars: int = RICH_VISUAL_MIN_CHARS,
) -> str:
    text = str(raw_output or "").strip()
    body_character_text = text
    for section in RICH_VISUAL_SECTIONS:
        body_character_text = body_character_text.replace(section, "", 1)
    if len(re.sub(r"\s+", "", body_character_text)) < max(
        0, int(minimum_body_chars)
    ):
        raise VisualContractError(
            "rich visual prompt is too short",
            code="rich-visual-prompt-invalid",
            semantic=True,
        )
    if "```" in text or not text.startswith(RICH_VISUAL_SECTIONS[0]):
        raise VisualContractError(
            "rich visual prompt has unsupported wrapper",
            code="rich-visual-prompt-invalid",
            semantic=True,
        )
    section_matches = list(
        re.finditer(r"(?m)^[ \t]*(\[[^\]\r\n]{1,40}\])[ \t]*$", text)
    )
    if tuple(match.group(1) for match in section_matches) != RICH_VISUAL_SECTIONS:
        raise VisualContractError(
            "rich visual prompt sections mismatch",
            code="rich-visual-prompt-invalid",
            semantic=True,
        )
    section_bodies: list[str] = []
    for index, section_match in enumerate(section_matches):
        body_end = (
            section_matches[index + 1].start()
            if index + 1 < len(section_matches)
            else len(text)
        )
        body = text[section_match.end():body_end].strip()
        section_bodies.append(body)
        if not re.search(r"[\u4e00-\u9fffA-Za-z0-9]", body):
            raise VisualContractError(
                "rich visual prompt contains an empty section",
                code="rich-visual-prompt-invalid",
                semantic=True,
            )
    if re.search(r"(?m)^[ \t]*(?:#|//|;)", text):
        raise VisualContractError(
            "rich visual prompt contains comments",
            code="rich-visual-prompt-invalid",
            semantic=True,
        )
    if sensitive and RICH_SENSITIVE_YOUNG_PATTERN.search(text):
        raise VisualContractError(
            "sensitive rich visual prompt contains young wording",
            code="rich-visual-prompt-invalid",
            semantic=True,
        )
    if require_interaction_evidence:
        normalized_text = _normalize_scan_text(section_bodies[1])
        if not (
            INTERACTION_RELATION_EVIDENCE_PATTERN.search(normalized_text)
            and _has_concrete_interaction_action(normalized_text)
            and SAFE_SENSITIVE_PATTERN.search(normalized_text)
        ):
            raise VisualContractError(
                "rich visual prompt lacks concrete interaction evidence",
                code="rich-visual-prompt-invalid",
                semantic=True,
            )
    return text


def append_rich_generation_requirements(rich_prompt: str, requirements: str = "") -> str:
    text = str(rich_prompt or "").strip()
    requirements_text = _clean_text(str(requirements or ""), 2000)
    if not requirements_text:
        return text
    return (
        f"{text}\n\n[用户附加要求]\n"
        f"要求 = {json.dumps(requirements_text, ensure_ascii=False)}"
    )


def compile_deterministic_rich_visual_prompt(
    contract: dict,
    *,
    sensitive: bool = False,
) -> str:
    """Compile a validated contract into the five editable rich prompt sections."""

    normalized = parse_visual_contract(
        json.dumps(contract, ensure_ascii=False),
        expected_schema=SCHEMA_VERSION_V2,
    )
    look = normalized["look"]
    scene = normalized["scene"]
    camera = normalized["camera_cues"]
    content_safety = normalized["content_safety"]

    def quoted(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False)

    style_lines = [
        f"资产类型 = {quoted(normalized['asset_type'])}",
        f"视觉风格 = {quoted('、'.join(look['style']) or '保持参考图可见的原有视觉风格')}",
        f"核心氛围 = {quoted(look['atmosphere'] or '保持参考图现有氛围与情绪表达')}",
        f"完成质感 = {quoted(look['finish'] or '保持参考图原有完成质感')}",
    ]

    subject_lines = [f"类别 = {quoted(normalized['asset_type'])}"]
    for index, entity in enumerate(normalized["entities"], start=1):
        prefix = f"主体{index}"
        identity = "".join(
            part for part in (entity["count"] or "", entity["name"] or "主体") if part
        )
        subject_lines.append(f"{prefix} = {quoted(identity)}")
        if entity["appearance"]:
            subject_lines.append(
                f"{prefix}.外观 = {quoted('、'.join(entity['appearance']))}"
            )
        if entity["pose"]:
            subject_lines.append(f"{prefix}.姿态 = {quoted(entity['pose'])}")
        if entity["action"]:
            subject_lines.append(f"{prefix}.动作 = {quoted(entity['action'])}")
        if entity["materials"]:
            subject_lines.append(
                f"{prefix}.材质 = {quoted('、'.join(entity['materials']))}"
            )
        if entity["colors"]:
            subject_lines.append(
                f"{prefix}.颜色 = {quoted('、'.join(entity['colors']))}"
            )
    if normalized["relations"]:
        subject_lines.append(
            f"可见关系 = {quoted('；'.join(normalized['relations']))}"
        )
    if normalized["ocr"]:
        subject_lines.append(f"画面文字 = {quoted('、'.join(normalized['ocr']))}")
    if sensitive and content_safety["sensitive_visible_facts"]:
        subject_lines.append(
            "敏感可见事实 = "
            f"{quoted('；'.join(content_safety['sensitive_visible_facts']))}"
        )

    environment_lines = [
        f"地点 = {quoted(scene['environment'] or '保持参考图现有环境')}",
        f"背景 = {quoted(scene['background'] or '保持参考图现有背景内容')}",
        f"空间层次 = {quoted('、'.join(scene['spatial_layers']) or '保持参考图现有前中后景关系')}",
    ]
    light_lines = [
        f"主光线 = {quoted('、'.join(look['lighting']) or '保持参考图现有光线方向与强度')}",
        f"色彩倾向 = {quoted('、'.join(look['palette']) or '保持参考图现有色彩关系')}",
        f"全局材质 = {quoted('、'.join(look['materials']) or '保持参考图现有材质差异')}",
        f"氛围 = {quoted(look['atmosphere'] or '保持参考图现有氛围')}",
    ]
    camera_lines = [
        f"景别 = {quoted(camera['shot'] or '保持参考图现有景别')}",
        f"视角 = {quoted(camera['angle'] or '保持参考图现有视角')}",
        f"构图 = {quoted(camera['composition'] or '保持参考图现有构图')}",
        f"景深 = {quoted(camera['depth_of_field'] or '保持参考图现有景深关系')}",
    ]
    sections = (
        (RICH_VISUAL_SECTIONS[0], style_lines),
        (RICH_VISUAL_SECTIONS[1], subject_lines),
        (RICH_VISUAL_SECTIONS[2], environment_lines),
        (RICH_VISUAL_SECTIONS[3], light_lines),
        (RICH_VISUAL_SECTIONS[4], camera_lines),
    )
    return "\n\n".join(
        f"{header}\n" + "\n".join(lines) for header, lines in sections
    )


def _dedupe(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        cleaned = _clean_text(value, 220)
        if cleaned and cleaned not in result:
            result.append(cleaned)
    return result


def _degraded_neutral_text(value: Any, limit: int = 160) -> str:
    cleaned = _clean_text(str(value or ""), limit)
    normalized = _normalize_scan_text(cleaned)
    if not normalized:
        return ""
    if (
        SAFE_SENSITIVE_PATTERN.search(normalized)
        or YOUNG_AGE_PATTERN.search(normalized)
        or DEGRADED_NON_NEUTRAL_PATTERN.search(normalized)
        or _has_concrete_interaction_action(normalized)
        or INTERACTION_RELATION_EVIDENCE_PATTERN.search(normalized)
    ):
        return ""
    return cleaned


def _degraded_neutral_list(
    values: list[str],
    *,
    item_limit: int = 160,
) -> list[str]:
    return _dedupe([
        cleaned
        for value in values
        if (cleaned := _degraded_neutral_text(value, item_limit))
    ])


def compile_degraded_visual_prompt_details(contract: dict) -> dict:
    """Compile only neutral, non-action v2 fields after a semantic gate failure."""

    normalized = parse_visual_contract(
        json.dumps(contract, ensure_ascii=False),
        expected_schema=SCHEMA_VERSION_V2,
        validate_semantics=False,
    )
    person_count = normalized["content_safety"]["visible_person_count"]
    content_safety = {
        "level": "uncertain",
        "body_exposure": "uncertain" if person_count > 0 else "none",
        "interaction_category": "uncertain" if person_count > 0 else "none",
        "age_assessment": (
            "age_unverifiable" if person_count > 0 else "not_applicable"
        ),
        "visible_person_count": person_count,
        "signals": [],
        "sensitive_visible_facts": [],
    }

    sentences: list[str] = []
    asset_type = _degraded_neutral_text(normalized["asset_type"], 40) or "通用"
    sentences.append(f"资产类型为{asset_type}")

    subject_parts: list[str] = []
    pose_parts: list[str] = []
    entity_colors: list[str] = []
    for entity in normalized["entities"]:
        name = _degraded_neutral_text(entity["name"], 120)
        count = _degraded_neutral_text(entity["count"], 40)
        appearance = _degraded_neutral_list(entity["appearance"])
        colors = _degraded_neutral_list(entity["colors"], item_limit=100)
        safe_pose = _safe_projection_pose(entity["pose"])
        if not any((name, count, appearance, colors, safe_pose)):
            continue
        display_name = name or "主体"
        identity = f"{count}{display_name}" if count else display_name
        if appearance:
            identity = f"{identity}，外观为{'、'.join(appearance)}"
        subject_parts.append(identity)
        if safe_pose:
            pose_parts.append(f"{display_name}姿势为{safe_pose}")
        if colors:
            entity_colors.append(f"{display_name}使用{'、'.join(colors)}")
    if subject_parts:
        sentences.append(f"主体包括{'；'.join(subject_parts)}")
    if pose_parts:
        sentences.append(f"姿态：{'；'.join(pose_parts)}")

    camera = normalized["camera_cues"]
    camera_parts = [
        f"景别为{value}" if key == "shot" else
        f"视角为{value}" if key == "angle" else
        f"构图为{value}" if key == "composition" else
        f"景深表现为{value}"
        for key in CAMERA_KEYS
        if (value := _degraded_neutral_text(camera[key], 160))
    ]
    if camera_parts:
        sentences.append("镜头与构图：" + "，".join(camera_parts))

    scene = normalized["scene"]
    environment = _degraded_neutral_text(scene["environment"], 200)
    background = _degraded_neutral_text(scene["background"], 200)
    spatial_layers = _degraded_neutral_list(scene["spatial_layers"])
    scene_parts = [
        f"环境为{environment}" if environment else "",
        f"空间层次为{'、'.join(spatial_layers)}" if spatial_layers else "",
        f"背景为{background}" if background else "",
    ]
    scene_parts = [part for part in scene_parts if part]
    if scene_parts:
        sentences.append("场景：" + "，".join(scene_parts))

    look = normalized["look"]
    lighting = _degraded_neutral_list(look["lighting"], item_limit=120)
    palette = _degraded_neutral_list(look["palette"], item_limit=100)
    styles = _degraded_neutral_list(look["style"], item_limit=120)
    atmosphere = _degraded_neutral_text(look["atmosphere"], 120)
    finish = _degraded_neutral_text(look["finish"], 120)
    color_light_parts = [
        f"光线为{'、'.join(lighting)}" if lighting else "",
        f"整体色板为{'、'.join(palette)}" if palette else "",
        f"氛围为{atmosphere}" if atmosphere else "",
        *entity_colors,
    ]
    color_light_parts = [part for part in color_light_parts if part]
    if color_light_parts:
        sentences.append("光色与氛围：" + "，".join(color_light_parts))
    style_parts = [
        f"视觉风格为{'、'.join(styles)}" if styles else "",
        f"完成质感为{finish}" if finish else "",
    ]
    style_parts = [part for part in style_parts if part]
    if style_parts:
        sentences.append("视觉风格：" + "，".join(style_parts))

    visual_prompt = "。".join(sentence.rstrip("。") for sentence in sentences) + "。"
    return {
        "prompt": visual_prompt,
        "visualPrompt": visual_prompt,
        "generationRequirements": "",
        "contentSafety": content_safety,
        "contentWarnings": [],
        "sensitivePromptBlocked": True,
        "generationGate": "blocked",
    }


def compile_partial_visual_prompt_details(
    contract: dict,
    requirements: str = "",
    *,
    nsfw: bool = False,
    failure_code: str = "visual-contract-interaction-evidence-incomplete",
) -> dict:
    """Compile a recoverable v2 failure without exposing its sensitive facts publicly."""

    normalized = parse_visual_contract(
        json.dumps(contract, ensure_ascii=False),
        expected_schema=SCHEMA_VERSION_V2,
        validate_semantics=(failure_code == "visual-contract-projection-redaction-required"),
        allow_projection_redaction=(
            failure_code == "visual-contract-projection-redaction-required"
        ),
    )
    neutral_details = compile_degraded_visual_prompt_details(normalized)
    content_safety = normalized["content_safety"]
    public_content_safety = {
        "level": content_safety["level"],
        "body_exposure": content_safety["body_exposure"],
        "interaction_category": content_safety["interaction_category"],
        "age_assessment": content_safety["age_assessment"],
        "visible_person_count": content_safety["visible_person_count"],
        "signals": list(content_safety["signals"]),
        "sensitive_visible_facts": [],
    }
    content_warnings = list(public_content_safety["signals"])
    sensitive_level = public_content_safety["level"] in {
        "suggestive",
        "nudity",
        "explicit",
    }
    requirements_explicit_minor = (
        _local_partial_requirements_contain_explicit_minor_terms(requirements)
    )
    requirements_sensitive = _requirements_contain_sensitive_terms(requirements)
    candidate_requirements = (
        requirements
        if requirements_explicit_minor
        else _neutralize_local_single_image_ambiguous_age_nouns(requirements)
    )
    requirements_minor_blocked = requirements_explicit_minor and (
        sensitive_level or requirements_sensitive
    )
    if requirements_minor_blocked:
        content_warnings.append("sensitive_prompt_minor_requirements")
    if sensitive_level and not nsfw:
        content_warnings.append("sensitive_prompt_nsfw_disabled")
    if (
        sensitive_level
        and public_content_safety["visible_person_count"] > 0
        and public_content_safety["age_assessment"] != "adult_appearing"
    ):
        content_warnings.append("sensitive_prompt_age_unconfirmed")
    age_assessment = public_content_safety["age_assessment"]
    partial_candidate_allowed = (
        failure_code in {
            "visual-contract-projection-redaction-required",
            "visual-contract-interaction-evidence-incomplete",
        }
        and sensitive_level
        and bool(nsfw)
        and public_content_safety["visible_person_count"] > 0
        and age_assessment in SENSITIVE_CANDIDATE_AGE_ASSESSMENTS
        and not requirements_minor_blocked
    )

    details = dict(neutral_details)
    if partial_candidate_allowed:
        candidate = compile_visual_prompt_details(
            normalized,
            "",
            nsfw=True,
            _validate_semantics=False,
        )
        candidate_requirement_text = _clean_text(
            str(candidate_requirements or ""),
            2000,
        )
        candidate_prompt = candidate["prompt"]
        if candidate_requirement_text:
            candidate_prompt = (
                f"{candidate_prompt.rstrip('。')}。用户附加要求："
                f"{candidate_requirement_text.rstrip('。')}。"
            )
        details.update({
            "prompt": candidate_prompt,
            "generationRequirements": candidate_requirement_text,
            "sensitivePromptBlocked": False,
            "generationGate": "adult_confirmation",
        })
    else:
        details.update({
            "generationRequirements": "",
            "sensitivePromptBlocked": True,
            "generationGate": "blocked",
        })

    details.update({
        "visualPrompt": neutral_details["visualPrompt"],
        "contentSafety": public_content_safety,
        "contentWarnings": _dedupe(content_warnings),
    })
    return details


def compile_visual_prompt_details(
    contract: dict,
    requirements: str = "",
    *,
    nsfw: bool = False,
    _validate_semantics: bool = True,
) -> dict:
    """Compile a visual contract and return prompt text plus safe metadata."""

    normalized = parse_visual_contract(
        json.dumps(contract, ensure_ascii=False),
        validate_semantics=_validate_semantics,
    )
    sentences: list[str] = []
    content_safety = normalized.get("content_safety") or {}
    requirements_text = _clean_text(str(requirements or ""), 2000)
    content_warnings: list[str] = []
    sensitive_prompt_blocked = False
    generation_gate = "direct"
    allow_sensitive_prompt = False
    sensitive_facts: list[str] = []
    if content_safety:
        level = content_safety["level"]
        age_assessment = content_safety["age_assessment"]
        visible_person_count = content_safety["visible_person_count"]
        sensitive_facts = content_safety["sensitive_visible_facts"]
        content_warnings.extend(content_safety["signals"])
        sensitive_level = level in {"suggestive", "nudity", "explicit"}
        requirements_explicit_minor = _requirements_contain_explicit_minor_terms(
            requirements_text
        )
        requirements_sensitive = _requirements_contain_sensitive_terms(
            requirements_text
        )
        requirements_minor_blocked = requirements_explicit_minor and (
            sensitive_level or requirements_sensitive
        )
        if requirements_minor_blocked:
            content_warnings.append("sensitive_prompt_minor_requirements")
        allow_sensitive_prompt = (
            sensitive_level
            and bool(nsfw)
            and visible_person_count > 0
            and age_assessment in SENSITIVE_CANDIDATE_AGE_ASSESSMENTS
            and not requirements_minor_blocked
        )
        if requirements_minor_blocked:
            generation_gate = "blocked"
        elif level == "uncertain":
            generation_gate = "blocked"
        elif sensitive_level:
            generation_gate = "adult_confirmation" if allow_sensitive_prompt else "blocked"
        else:
            generation_gate = "direct"
        policy_blocked = sensitive_level and generation_gate == "blocked"
        sensitive_prompt_blocked = generation_gate == "blocked"
        if policy_blocked:
            if not nsfw:
                content_warnings.append("sensitive_prompt_nsfw_disabled")
            if (
                visible_person_count > 0
                and age_assessment not in SENSITIVE_CANDIDATE_AGE_ASSESSMENTS
            ):
                content_warnings.append("sensitive_prompt_age_unconfirmed")
        elif sensitive_level and age_assessment == "age_unverifiable":
            content_warnings.append("sensitive_prompt_age_unconfirmed")

    subject_parts: list[str] = []
    action_parts: list[str] = []
    entity_colors: list[str] = []
    entity_materials: list[str] = []
    if sensitive_prompt_blocked:
        visible_person_count = content_safety["visible_person_count"]
        sentences.append(f"资产类型为{normalized['asset_type']}")
        for entity in normalized["entities"]:
            name = entity["name"] or ("人物" if visible_person_count > 0 else "主体")
            count = entity["count"]
            identity = f"{count}{name}" if count else name
            if entity["appearance"]:
                identity = f"{identity}，外观为{'、'.join(entity['appearance'])}"
            subject_parts.append(identity)
            safe_pose = _safe_projection_pose(entity["pose"])
            if safe_pose:
                action_parts.append(f"{name}姿势为{safe_pose}")
            if entity["colors"]:
                entity_colors.append(f"{name}使用{'、'.join(entity['colors'])}")
        if visible_person_count > 0 and not subject_parts:
            sentences.append(f"画面包含{visible_person_count}个可见人物")
    else:
        for entity in normalized["entities"]:
            name = entity["name"] or "主体"
            count = entity["count"]
            identity = f"{count}{name}" if count else name
            if entity["appearance"]:
                identity = f"{identity}，外观为{'、'.join(entity['appearance'])}"
            subject_parts.append(identity)
            motion = "，".join(
                part for part in (
                    f"姿势为{entity['pose']}" if entity["pose"] else "",
                    f"动作为{entity['action']}" if entity["action"] else "",
                )
                if part
            )
            if motion:
                action_parts.append(f"{name}{motion}")
            if entity["colors"]:
                entity_colors.append(f"{name}使用{'、'.join(entity['colors'])}")
            if entity["materials"]:
                entity_materials.append(f"{name}呈现{'、'.join(entity['materials'])}")
    if subject_parts:
        sentences.append(f"主体包括{'；'.join(subject_parts)}")
    if normalized["relations"] and not sensitive_prompt_blocked:
        sentences.append(f"可见关系为{'；'.join(normalized['relations'])}")
    if action_parts:
        sentences.append(f"姿态与动作：{'；'.join(action_parts)}")

    if normalized["ocr"]:
        quoted = "、".join(f"“{value}”" for value in normalized["ocr"])
        sentences.append(f"画面可见文字准确保留为{quoted}")

    camera = normalized["camera_cues"]
    camera_parts = [
        f"景别为{camera['shot']}" if camera["shot"] else "",
        f"视角为{camera['angle']}" if camera["angle"] else "",
        f"构图为{camera['composition']}" if camera["composition"] else "",
        f"景深表现为{camera['depth_of_field']}" if camera["depth_of_field"] else "",
    ]
    camera_parts = [part for part in camera_parts if part]
    if camera_parts:
        sentences.append("镜头与构图：" + "，".join(camera_parts))

    scene = normalized["scene"]
    scene_parts = [
        f"环境为{scene['environment']}" if scene["environment"] else "",
        f"空间层次为{'、'.join(scene['spatial_layers'])}" if scene["spatial_layers"] else "",
        f"背景为{scene['background']}" if scene["background"] else "",
    ]
    scene_parts = [part for part in scene_parts if part]
    if scene_parts:
        sentences.append("场景：" + "，".join(scene_parts))

    look = normalized["look"]
    color_light_parts = [
        f"光线为{'、'.join(look['lighting'])}" if look["lighting"] else "",
        f"整体色板为{'、'.join(look['palette'])}" if look["palette"] else "",
        f"氛围为{look['atmosphere']}" if look["atmosphere"] else "",
        *entity_colors,
    ]
    color_light_parts = [part for part in color_light_parts if part]
    if color_light_parts:
        sentences.append("光色与氛围：" + "，".join(color_light_parts))

    material_style_parts = [
        *entity_materials,
        (
            f"全局材质为{'、'.join(look['materials'])}"
            if look["materials"] and not sensitive_prompt_blocked
            else ""
        ),
        f"视觉风格为{'、'.join(look['style'])}" if look["style"] else "",
        f"完成质感为{look['finish']}" if look["finish"] else "",
    ]
    material_style_parts = _dedupe([part for part in material_style_parts if part])
    if material_style_parts:
        sentences.append("材质与风格：" + "，".join(material_style_parts))

    if sensitive_facts and allow_sensitive_prompt:
        sentences.append("敏感可见事实：" + "；".join(sensitive_facts))

    if not sentences:
        raise VisualContractError("visual contract contains no compilable facts")
    visual_prompt = "。".join(sentence.rstrip("。") for sentence in sentences) + "。"
    prompt = visual_prompt
    if requirements_text and not sensitive_prompt_blocked:
        prompt = f"{visual_prompt.rstrip('。')}。用户附加要求：{requirements_text.rstrip('。')}。"
    public_visual_prompt = visual_prompt
    if generation_gate == "adult_confirmation":
        public_visual_prompt = compile_degraded_visual_prompt_details(normalized)["visualPrompt"]
    return {
        "prompt": prompt,
        "visualPrompt": public_visual_prompt,
        "generationRequirements": (
            "" if content_safety and requirements_minor_blocked else requirements_text
        ),
        "contentSafety": content_safety,
        "contentWarnings": _dedupe(content_warnings),
        "sensitivePromptBlocked": sensitive_prompt_blocked,
        "generationGate": generation_gate,
    }


def compile_visual_prompt(
    contract: dict,
    requirements: str = "",
    *,
    nsfw: bool = False,
) -> str:
    """Compile nf.visual.v1/v2 into deterministic Chinese natural language."""

    return compile_visual_prompt_details(contract, requirements, nsfw=nsfw)["prompt"]
