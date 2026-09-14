from __future__ import annotations

import json
import re
from typing import Any


SCHEMA_VERSION = "nf.art.prompt.v1"
EDIT_CONTRACT = "structured-recompile-v1"
STRUCTURED_OUTPUT_MAX_TOKENS = 2048
SIMPLE_STRUCTURED_OUTPUT_MAX_TOKENS = 768
_SIMPLE_SUBJECT_COUNT_PATTERN = re.compile(
    r"(?P<count>[一二两三四五六1-6])\s*(?:名|位|个|只|条|匹|辆|艘|件)?"
)
_SIMPLE_SUBJECT_NAME_UNBOUNDED_COUNT_PATTERN = re.compile(
    r"(?:一群|一组|多名|多人|多个|若干|数名|成群|成组)"
    r"|(?<![a-z0-9_])(?:many|several|multiple|a\s+group\s+of|a\s+crowd\s+of)(?![a-z0-9_])",
    re.I,
)
_SIMPLE_SUBJECT_NAME_EXPLICIT_COUNT_PATTERN = re.compile(
    r"(?P<count>[一二两三四五六1-6])\s*(?:名|位|人|个|只|条|匹|辆|件)"
    r"|(?P<pair>一对|双胞胎|双生|二人组|双人(?:组|组合)?)"
    r"|(?<![a-z0-9_])(?P<english>one|two|three|four|five|six)\s+"
    r"(?:adult\s+)?(?:woman|women|man|men|people|persons?|characters?|girls?|boys?|dogs?|cats?|horses?|animals?|robots?|cars?|vehicles?|birds?)(?![a-z0-9_])"
    r"|(?<![a-z0-9_])(?P<twins>twins?)(?![a-z0-9_])",
    re.I,
)
_SIMPLE_SUBJECT_NAME_PLURAL_SEMANTICS_PATTERN = re.compile(
    r"(?:们|姐妹|兄弟|母女|父女|母子|父子|夫妻|情侣|队伍|众人|双人(?:组|组合)?|二人组)"
    r"|(?<![a-z0-9_])(?:women|men|people|persons|characters|girls|boys|dogs|cats|horses|animals|robots|cars|vehicles|birds|sisters|brothers|couples|partners)(?![a-z0-9_])",
    re.I,
)
SECTIONS = (
    "[风格设定]",
    "[主体物品]",
    "[环境背景]",
    "[光线与色彩]",
    "[拍摄参数]",
    "[用户附加要求]",
)

_TOP_LEVEL_KEYS = (
    "schema",
    "subject_count",
    "style",
    "subjects",
    "relations",
    "environment",
    "lighting_color",
    "camera",
    "applied_requirements",
    "terminal_constraints",
)
_STYLE_KEYS = ("medium", "render_language", "atmosphere", "finish")
_SUBJECT_KEYS = (
    "name",
    "count",
    "appearance",
    "pose",
    "action",
    "materials",
    "colors",
    "details",
)
_ENVIRONMENT_KEYS = (
    "setting",
    "background",
    "spatial_layers",
    "support_surface",
    "occlusion",
)
_LIGHTING_KEYS = (
    "light_direction",
    "light_quality",
    "light_shadow",
    "rim_light",
    "palette",
    "local_colors",
)
_CAMERA_KEYS = (
    "shot",
    "angle",
    "composition",
    "crop",
    "perspective",
    "depth_of_field",
)
_META_OPERATION_PATTERN = re.compile(
    r"(?:"
    r"(?:^|[\s\"'，。；;：:])(?:请|需要|需|应该|应当|建议|尝试|可以|必须|务必).{0,48}"
    r"(?:修改|调整|增加|添加|删除|移除|降低|提高|改成|改为|替换|优化|增强|补充|保留)"
    r"|(?:^|[\s\"'，。；;：:])"
    r"(?:修改|调整|增加|添加|删除|移除|降低|提高|改成|改为|替换|优化|增强|补充|保留)"
    r".{0,16}(?:画面|提示词|内容|主体|背景|人物|角色|镜头|光线|光影|质感|构图|服装|姿势|色彩|风格|细节|曝光)"
    r"|\b(?:please|should|need(?:s|ed)?(?:\s+to)?)\b.{0,80}\b"
    r"(?:modify|adjust|add|remove|delete|increase|decrease|improve|change|replace|"
    r"optimi[sz]e|enhance|preserve|make|use|set)\b"
    r"|(?:^|[，,。；;！!？?:：\n\r])\s*"
    r"(?:modify|increase|decrease|add|improve|adjust|change|replace|remove|delete|"
    r"optimi[sz]e|enhance|preserve|make|use|set)\b"
    r"|(?:^|[\"'.,;:\s])(?:modify|adjust|add|remove|delete|increase|decrease|improve|"
    r"change|replace|optimi[sz]e|enhance|preserve|make|use|set)\s+(?:the\s+)?"
    r"(?:image|prompt|content|subject|background|character|camera|lighting?|texture|"
    r"composition|costume|pose|colo(?:u)?r|style|detail|exposure)\b"
    r")",
    flags=re.I,
)
_FRONT_FIELD_NON_FINAL_PATTERN = re.compile(
    r"(?:"
    r"(?:^|[，,。；;！!？?:：\n\r])\s*(?:请勿|不要|不得|禁止|避免|确保|保证)\s*"
    r"(?:裁切|遮挡|修改|调整|增加|添加|删除|移除|改变|替换|优化|增强|保留|保持|"
    r"人物|主体|角色|画面|背景|镜头|构图|光线)"
    r"|(?:^|[，,。；;！!？?:：\n\r])\s*(?:无|没有)(?:任何)?(?:遮挡|裁切|缺失|变形|融合)"
    r"|(?:^|[，,。；;！!？?:：\n\r])\s*(?:这|以下|下面)(?:是|为)"
    r"(?:已经?|本次)?(?:优化|修改|调整|更新|重写)后的?(?:最终)?提示词"
    r"|(?:^|[,.;:!?\n\r])\s*(?:(?:please\s+)?(?:do\s+not|don't)|never|avoid)\s+[a-z]"
    r"|(?:^|[,.;:!?\n\r])\s*without\s+(?:any\s+)?"
    r"(?:occlusions?|cropping|crops?|support(?:ing)?\s+surfaces?|relationships?)\b"
    r"|(?:^|[,.;:!?\n\r])\s*(?:no|zero)\s+(?:occlusions?|cropping|crops?|obstructions?|"
    r"missing\s+(?:figures?|characters?|subjects?))\b"
    r"|\b(?:figures?|characters?|people|persons?|subjects?|silhouettes?)\b.{0,48}\b"
    r"(?:must|should|can)\s+not\s+be\s+(?:cropped|occluded|obstructed|removed|changed|modified)\b"
    r"|(?:^|[,.;:!?\n\r])\s*(?:ensure|make\s+sure)\s+(?:that\s+)?"
    r"(?:there\s+(?:is|are)\s+)?(?:no|zero|not\s+any)\s+[a-z]"
    r"|(?:^|[,.;:!?\n\r])\s*(?:crop|occlude|keep|ensure|make|use|set|remove|add|adjust|"
    r"change|preserve|optimi[sz]e|enhance)\s+(?:the\s+|both\s+|all\s+)?"
    r"(?:figures?|characters?|people|persons?|subjects?|silhouettes?|background|image|prompt|"
    r"camera|framing|composition|lighting?|details?)\b"
    r"|(?:^|[,.;:!?\n\r])\s*(?:(?:here(?:'s|\s+is)|below\s+(?:is|are))\s+"
    r"(?:the\s+|an?\s+|your\s+)?(?:optimized|optimised|revised|modified|updated|final)\s+"
    r"(?:prompt|result|version)|(?:the\s+)?(?:optimized|optimised|revised|modified|updated|final)\s+"
    r"prompt\s*(?:is\b|follows\b|[:：])|i(?:'ve|\s+have)\s+"
    r"(?:optimized|optimised|revised|modified|updated)\s+(?:the\s+|your\s+)?prompt\b)"
    r")",
    flags=re.I,
)
_TERMINAL_HARD_CONSTRAINT_PATTERN = re.compile(
    r"(?:必须|不得|禁止|避免|保持|只允许|不能|不允许|不可|务必|"
    r"结构正确|归属明确|清晰可辨|质量底线|画面目标|高完成度|"
    r"成年人?|成人(?:女性|男性|主体|角色)?|\d+\s*岁以上|年龄|身份|"
    r"主体数量|人物数量|人数|解剖|肢体|手指|手臂|双腿|五官|脸部|"
    r"must|required|requirement|avoid|never|only|keep|constraint|target)",
    flags=re.I,
)

_SLOT_SEMANTIC_PATTERNS = {
    "style.medium": re.compile(
        r"(?:数字绘画|数字插画|厚涂|插画|水彩|油画|素描|版画|摄影|胶片|像素画|"
        r"三维|3D|CG|手绘|digital\s+(?:painting|illustration|art)|"
        r"oil\s+painting|watercolou?r|gouache|photograph\w*|film|pixel\s+art|"
        r"3d\s+(?:render|art)|illustration)",
        re.I,
    ),
    "style.render_language": re.compile(
        r"(?:厚涂|半写实|写实|二次元|动漫|赛璐璐|笔触|线条|渲染|造型|设计|性感|造型语言|"
        r"体积塑造|明暗塑造|游戏CG|角色原画|painterly|semi[-\s]*realistic|"
        r"photorealistic|anime|manga|cel[-\s]*shad(?:ed|ing)|brushwork|"
        r"linework|render(?:ed|ing)?|painting|character\s+design|styling|sensual|"
        r"game\s+cg|concept\s+art|splash\s+art)",
        re.I,
    ),
    "style.atmosphere": re.compile(
        r"(?:氛围|气氛|意境|情绪|调性|审美|浪漫|亲密|成熟|性感|成人向|温暖|暖色|"
        r"冷峻|神秘|史诗|宁静|梦幻|清透|romantic|intimate|mature|sensual|"
        r"adult[-\s]*oriented|warm|cool|mood|atmosphere|ambience|ambiance|tone|aesthetic|dreamlike|epic)",
        re.I,
    ),
    "style.finish": re.compile(
        r"(?:质感|细节|高光|阴影|过渡|纹理|完成度|精度|清晰|锐利|柔润|反光|"
        r"层次|材质|material|detail|texture|highlight|shadow|transition|polish|"
        r"finish|resolution|layer|surface|reflection)",
        re.I,
    ),
    "camera.shot": re.compile(
        r"(?:景别|特写|近景|中景|远景|全景|全身|半身|胸像|头像|产品|"
        r"close[-\s]*up|medium\s+shot|wide\s+shot|long\s+shot|full[-\s]*body|"
        r"half[-\s]*body|bust\s+shot|headshot|product\s+shot)",
        re.I,
    ),
    "camera.angle": re.compile(
        r"(?:视角|俯视|仰视|平视|侧视|正面|背面|鸟瞰|低角度|高角度|"
        r"eye[-\s]*level|high[-\s]*angle|low[-\s]*angle|top[-\s]*down|"
        r"bird'?s[-\s]*eye|front\s+view|side\s+view|rear\s+view)",
        re.I,
    ),
    "camera.composition": re.compile(
        r"(?:构图|布局|视觉中心|视觉焦点|动线|三角|对称|居中|对角线|留白|"
        r"composition|layout|focal\s+point|visual\s+flow|triangular|symmetr\w*|"
        r"centered|diagonal|negative\s+space|rule\s+of\s+thirds)",
        re.I,
    ),
    "camera.perspective": re.compile(
        r"(?:透视|焦段|镜头|畸变|广角|长焦|标准|正交|消失点|空间纵深|近大远小|"
        r"perspective|foreshorten\w*|orthographic|wide[-\s]*angle|telephoto|"
        r"lens|distortion|vanishing\s+point|spatial\s+depth|standard\s+view)",
        re.I,
    ),
    "camera.depth_of_field": re.compile(
        r"(?:景深|焦点|对焦|清晰|虚化|散景|前景|中景|背景|"
        r"depth\s+of\s+field|deep\s+focus|shallow\s+focus|focus(?:ed)?|"
        r"blur(?:red)?|bokeh|foreground|background)",
        re.I,
    ),
}

_SLOT_GENERIC_VALUES = {
    "style.medium": {"art", "image", "绘画", "艺术"},
    "style.render_language": {
        "chinese", "english", "japanese", "中文", "英文", "日文", "中国", "东方", "style",
    },
    "style.atmosphere": {"mood", "atmosphere", "tone", "氛围", "气氛", "调性"},
    "style.finish": {"high", "highquality", "quality", "detailed", "refined", "高", "高级", "高清", "高质量"},
    "camera.shot": {"shot", "view", "镜头", "画面"},
    "camera.angle": {"angle", "view", "角度", "视角"},
    "camera.composition": {"composition", "layout", "构图", "布局"},
    "camera.perspective": {"intimate", "romantic", "soft", "亲密", "浪漫", "柔和", "自然"},
    "camera.depth_of_field": {"soft", "smooth", "clear", "柔和", "清晰", "自然"},
}

_SIMPLE_LIGHT_SLOT_PATTERNS = {
    "light_direction": re.compile(
        r"(?:方向|左上|右上|左下|右下|左侧|右侧|上方|下方|前方|后方|"
        r"顶光|侧光|逆光|顺光|斜射|入射|照射)"
        r"|(?<![a-z])(?:direction|from|left|right|above|below|front|back|"
        r"overhead|side[-\s]*light|backlit)(?![a-z])",
        re.I,
    ),
    "light_quality": re.compile(
        r"(?:光质|软硬|柔和|软光|硬光|硬质(?:冷|暖)?光|扩散|漫射|聚光|均匀|高调|低调)"
        r"|(?<![a-z])(?:soft|hard|diffus(?:e|ed)|scattered|focused|even|"
        r"high[-\s]*key|low[-\s]*key)(?![a-z])",
        re.I,
    ),
}

_DETERMINISTIC_CANONICAL_SLOT_FACTS = (
    "画面质感细腻丰富",
    "人物造型性感且成年比例明确",
    "偏成人向的成熟审美氛围",
    "image quality is refined with rich material detail",
    "character design is sensual with clearly adult proportions",
    "mature adult-oriented aesthetic atmosphere",
)


class ArtPromptContractError(ValueError):
    """Raised when Local ordinary-Art output is not a strict final-state IR."""

    def __init__(self, message: str, *, code: str = "art-prompt-contract-invalid"):
        self.code = code
        super().__init__(message)


def _reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ArtPromptContractError(
                f"duplicate key: {key}",
                code="art-prompt-contract-duplicate-key",
            )
        result[key] = value
    return result


def _require_exact_keys(value: Any, keys: tuple[str, ...], path: str) -> dict:
    if not isinstance(value, dict):
        raise ArtPromptContractError(f"{path} must be an object")
    if set(value.keys()) != set(keys):
        missing = sorted(set(keys) - set(value.keys()))
        extra = sorted(str(key) for key in set(value.keys()) - set(keys))
        raise ArtPromptContractError(
            f"{path} keys mismatch; missing={','.join(missing) or '-'}; "
            f"extra={','.join(extra) or '-'}"
        )
    return value


def _clean_text(value: Any, path: str, *, limit: int = 400, required: bool = True) -> str:
    if not isinstance(value, str):
        raise ArtPromptContractError(f"{path} must be a string")
    if "```" in value:
        raise ArtPromptContractError(
            f"{path} contains a Markdown fence",
            code="art-prompt-contract-markdown-fence",
        )
    if value.strip() and _META_OPERATION_PATTERN.search(value.strip()):
        raise ArtPromptContractError(
            f"{path} contains an operation instruction",
            code="art-prompt-contract-meta-instruction",
        )
    if (
        not path.startswith("terminal_constraints")
        and value.strip()
        and _FRONT_FIELD_NON_FINAL_PATTERN.search(value.strip())
    ):
        raise ArtPromptContractError(
            f"{path} contains a non-final prompt instruction",
            code="art-prompt-contract-meta-instruction",
        )
    cleaned = re.sub(r"\s+", " ", value).strip()
    if required and not cleaned:
        raise ArtPromptContractError(f"{path} must not be empty")
    if len(cleaned) > limit:
        raise ArtPromptContractError(f"{path} is too long")
    return cleaned


def _text_list(
    value: Any,
    path: str,
    *,
    max_items: int,
    item_limit: int = 240,
    required: bool = False,
) -> list[str]:
    if not isinstance(value, list):
        raise ArtPromptContractError(f"{path} must be an array")
    if len(value) > max_items:
        raise ArtPromptContractError(f"{path} has too many items")
    result: list[str] = []
    for index, item in enumerate(value):
        cleaned = _clean_text(
            item,
            f"{path}[{index}]",
            limit=item_limit,
            required=True,
        )
        if cleaned not in result:
            result.append(cleaned)
    if required and not result:
        raise ArtPromptContractError(f"{path} must not be empty")
    return result


def _validate_typed_slot(path: str, value: str) -> None:
    evidence_value = value
    for canonical in _DETERMINISTIC_CANONICAL_SLOT_FACTS:
        evidence_value = re.sub(
            re.escape(canonical),
            " ",
            evidence_value,
            flags=re.I,
        )
    evidence_value = re.sub(r"^[\s，,。.;；:：]+|[\s，,。.;；:：]+$", "", evidence_value)
    compact = _normalized_fact_key(evidence_value)
    generic_values = _SLOT_GENERIC_VALUES.get(path, set())
    if (
        not compact
        or compact in generic_values
        or not _SLOT_SEMANTIC_PATTERNS[path].search(evidence_value)
    ):
        raise ArtPromptContractError(
            f"{path} is generic or does not describe its slot semantics",
            code="art-prompt-contract-slot-semantic",
        )


def _validate_slot_semantics(contract: dict) -> None:
    style = contract["style"]
    camera = contract["camera"]
    for key in _STYLE_KEYS:
        _validate_typed_slot(f"style.{key}", style[key])
    for key in (
        "shot",
        "angle",
        "composition",
        "perspective",
        "depth_of_field",
    ):
        _validate_typed_slot(f"camera.{key}", camera[key])


def _validate_simple_light_slot_semantics(contract: dict) -> None:
    lighting = contract["lighting_color"]
    for key, pattern in _SIMPLE_LIGHT_SLOT_PATTERNS.items():
        value = str(lighting.get(key) or "").strip()
        if not value or not pattern.search(value):
            raise ArtPromptContractError(
                f"lighting_color.{key} does not describe its slot semantics",
                code="art-prompt-contract-slot-semantic",
            )


def build_art_prompt_contract_instruction(
    current_prompt: str,
    user_instruction: str,
    *,
    hard_constraint_blocks: list[str] | None = None,
    resource_tokens: list[str] | None = None,
    nsfw_enabled: bool = False,
) -> str:
    """Build the one-call text-to-final-state IR instruction."""

    skeleton = {
        "schema": SCHEMA_VERSION,
        "subject_count": 1,
        "style": {
            "medium": "",
            "render_language": "",
            "atmosphere": "",
            "finish": "",
        },
        "subjects": [{
            "name": "",
            "count": "",
            "appearance": [],
            "pose": "",
            "action": "",
            "materials": [],
            "colors": [],
            "details": [],
        }],
        "relations": [],
        "environment": {
            "setting": "",
            "background": "",
            "spatial_layers": [],
            "support_surface": "",
            "occlusion": [],
        },
        "lighting_color": {
            "light_direction": "",
            "light_quality": "",
            "light_shadow": "",
            "rim_light": "",
            "palette": [],
            "local_colors": [],
        },
        "camera": {
            "shot": "",
            "angle": "",
            "composition": "",
            "crop": "",
            "perspective": "",
            "depth_of_field": "",
        },
        "applied_requirements": [],
        "terminal_constraints": [""],
    }
    hard_constraints = [
        re.sub(r"\s+", " ", str(item or "")).strip()
        for item in (hard_constraint_blocks or [])
        if str(item or "").strip()
    ]
    resources = [
        str(item or "").strip()
        for item in (resource_tokens or [])
        if str(item or "").strip()
    ]
    adult_rule = (
        "NSFW 已开启：只允许明确成年人物；必须保留或落实成年身份。"
        "不得输出任何肯定的未成年人设定，也不得把成年人物年轻化。"
        if nsfw_enabled else
        "不得擅自改变原提示词中的年龄身份。"
    )


    change = str(user_instruction or "").strip() or "<无>"
    return (
        "你是 NovaFlow 普通 Art 提示词的结构化重编译器。只输出一个合法 JSON 对象，"
        "不要 Markdown、解释、前后缀、正向/负向标题或多个方案。"
        "当前完整 Prompt 是唯一语义底稿；用户本次修改要求拥有最高优先级。"
        "先在语义上完成修改，再输出修改完成后的最终画面状态；禁止输出修改建议、操作步骤、差异说明或原问题状态。"
        "先分析完整底稿再融合补充要求。丰富感、丰富度等开放要求，应结合底稿已有对象，选择适合原画风的空间层次、材质纹理、光影过渡、色彩呼应或绘画细节中的至少两个维度，形成一条具体终态事实写入对应字段。不要只复述更丰富、更高清，不得新增无关主体。文字中的参考图指代只绑定底稿描述，不得声称看到了未提供的图片。"
        "未被用户要求改变的主体身份与数量、外观服装、动作关系、场景、构图镜头、风格材质、"
        "光影色彩、质量要求、避免项和资源占位符必须保留。"
        "必须把用户修改结果实际写入 style、subjects、relations、environment、lighting_color、camera 这些前五段来源字段；"
        "terminal_constraints 不能代替前五段落实用户修改。"
        "applied_requirements 是逐条验收账本：若用户本次修改要求为空，它必须是空数组；"
        "否则，每个有效修改分句恰好对应一项 applied_requirements，总数必须严格相等且按用户分句原顺序一一对应；"
        "每项都是一条简短、具体、已经实现的最终画面事实。"
        "每条 applied_requirements 必须完整逐字复制一个彼此不同的前五段来源字段标量值，不得截取子串，"
        "并保留对应用户分句中至少一个有辨识度的名词、属性词或质量词作为验收锚点；"
        "不能写操作、计划、建议、摘要或要求原文。"
        "terminal_constraints 只填写最终状态的硬约束、避免项、质量底线和画面目标，"
        "并且至少填写一项；"
        "原底稿硬约束中的可见正向事实还必须写入其正确的前五段字段：人物定位、服装颜色、姿态动作、"
        "环境、光线和镜头不能只在 terminal_constraints 重复；避免项所禁止的可见对象或坏属性不得在"
        "前五段中作为肯定事实出现。左右、A/B、主体序号等归属必须逐人物对应，不能跨对象拼接颜色和物件。"
        "原底稿中未被明确修改的普通可见事实也必须进入对应前五段：同一人物的颜色、材质和服装物件要局部绑定，"
        "场景、光源方向与色温、景别、视角、透视和景深必须留在各自字段，不能靠其他字段或终态约束代替。"
        "不得照抄‘增加、修改、调整、删除、应该、建议、请’等操作性要求。"
        "每个可见人物或独立物体分别写一个 subject；subject_count 必须等于 subjects 数量。"
        "所有 style 标量、environment 标量、lighting_color 标量和 camera 标量都必须填写具体内容；"
        "数组按画面事实拆成短语，避免同义重复。最终 IR 应足以确定性编译为详细生图提示词。"
        "字段必须按视觉语义填写：style.medium 是具体媒介与制作方式；style.render_language 是厚涂、半写实、"
        "二次元、笔触、线条、渲染等绘画语言，不是中文/英文或国家名；style.atmosphere 是包含至少两个具体"
        "情绪或审美属性的氛围；style.finish 是材质、纹理、高光、阴影、层次、过渡等完成质感，不能只写 high。"
        "camera.shot 是景别，camera.angle 是观察角度，camera.composition 是画面组织，camera.perspective 是"
        "几何或镜头透视，不能写亲密、浪漫等情绪，camera.depth_of_field 必须说明焦点、清晰范围或背景虚化，"
        "不能只写柔和。每个标量都应包含具体名词和属性，不得只写 illustration、Chinese、romantic、high 这类"
        "单词级占位答案。以编译后约1000至1600个中文字的信息密度填写；源底稿更详细时优先完整保留，不得为凑字数"
        "删除身份、外观、服装、动作关系、解剖归属、场景、光色、镜头或硬约束事实。"
        f"{adult_rule}"
        "顶层和嵌套键集合必须与下列模板严格一致且不得增删；键顺序不限，模板值不是答案："
        f"{json.dumps(skeleton, ensure_ascii=False, separators=(',', ':'))}\n"
        f"用户本次修改要求：{change[:2000]}\n"
        f"必须保留的原有硬约束块：{json.dumps(hard_constraints, ensure_ascii=False)}\n"
        f"必须原样、原次数保留的资源占位符：{json.dumps(resources, ensure_ascii=False)}\n"
        "当前完整 Prompt：\n"
        f"{str(current_prompt or '').strip()[:20000]}\n"
        "现在只输出单一严格 JSON。"
    )


def build_simple_art_prompt_contract_instruction(
    current_prompt: str,
    user_instruction: str,
    *,
    nsfw_enabled: bool = False,
    repair_output: str = "",
    repair_reason: str = "",
) -> str:
    """Build the bounded final-TOML contract used for sparse Art prompts."""

    adult_rule = (
        "NSFW 已开启：含泳装、内衣、裸露或成人语境的人物只能写成明确成年人物；"
        "原文的女/女性不得改成少女、女孩或任何更年轻身份。"
        if nsfw_enabled else
        "不得擅自改变人物年龄；原文的女/女性不得改成少女、女孩。"
    )
    change = str(user_instruction or "").strip() or "<无>"
    repair = ""
    if str(repair_output or "").strip():
        repair = (
            "\n上一次输出未通过格式或字段校验。不要解释错误，重新观察底稿并从头输出。"
            f"\n失败类型：{str(repair_reason or 'invalid-contract')[:120]}"
            "\n上一次输出仅供识别格式错误，不得复制其中新增的主体、道具、地点、颜色、天气或年龄："
            f"\n{str(repair_output or '')[:6000]}\n"
        )
    return (
        "你是 NovaFlow 普通 Art 短提示词的结构化详化器。"
        "只输出一份最终可生图的 TOML 风格文本，不要 JSON、Markdown 围栏、解释、前后缀或多个方案。"
        "必须严格使用下面六个分区、固定键名和顺序；除主体数量外，每个值都必须是合法 JSON 双引号字符串。"
        "主体数量写 1 到 6 的整数；有几名或几只明确独立的人物、动物，就完整输出几组主体字段；"
        "只有原文明写独立数量词的关键道具才可另列主体，作为人物动作宾语出现的道具保留在动作或外观中。"
        "每个主体必须填写名称、数量、外观、姿态、动作、材质、颜色、局部细节，列表内容用中文分号分隔。"
        "环境、光线和镜头每个槽位都必须填写具体的最终画面事实，不得留空、写未知、写无要求或写操作建议。"
        "输出总长度以 400 到 800 个中文字符为目标。"
        "当前完整 Prompt 是唯一语义底稿：必须保留其中的主体、数量、身份、动作关系、地点和风格。"
        "允许专业补全线条与上色语言、已出现材质的表现、自然光、构图、景别、透视、景深和结构质量；"
        "禁止新增原文没有的人物、动物、道具、建筑、剧情、犬种、服装款式、具体颜色、时间或天气。"
        "关系必须逐主体写清；不得把女性与犬只合并为一个主体。"
        f"{adult_rule}"
        "若用户本次修改要求为<无>，只做细节详化，要求段仍写至少一条保留底稿和禁止新增实体的硬约束。"
        "若修改要求非空，必须在前五段落实，并在要求段写成已经满足的最终约束。"
        "严格模板如下；按主体数量重复主体N的八个键，不要保留尖括号占位符：\n"
        "[风格设定]\n"
        "媒介 = \"<具体媒介>\"\n"
        "绘画语言 = \"<具体绘画与渲染语言>\"\n"
        "氛围 = \"<具体氛围>\"\n"
        "完成质感 = \"<具体完成质感>\"\n\n"
        "[主体物品]\n"
        "主体数量 = <整数>\n"
        "主体1 = \"<与主体1数量一致的精确数量短语加身份名称，例如一名成年女性；禁止无界复数名称>\"\n"
        "主体1数量 = \"<数量短语>\"\n"
        "主体1外观 = \"<外观事实；外观事实>\"\n"
        "主体1姿态 = \"<姿态>\"\n"
        "主体1动作 = \"<动作>\"\n"
        "主体1材质 = \"<材质；材质>\"\n"
        "主体1颜色 = \"<只保留原文已有颜色；未指定时写固有色层次清晰而不指定色相>\"\n"
        "主体1局部细节 = \"<结构与局部质量事实；局部质量事实>\"\n"
        "主体关系 = \"<主体之间的可见关系；单主体则写单主体无额外关系>\"\n\n"
        "[环境背景]\n"
        "环境 = \"<地点与环境>\"\n"
        "背景 = \"<不新增地点的背景层次>\"\n"
        "前中后景 = \"<前景；中景；后景>\"\n"
        "承托面 = \"<主体与地面的承托关系>\"\n"
        "遮挡层次 = \"<遮挡和空间归属>\"\n\n"
        "[光线与色彩]\n"
        "光源方向 = \"<通用自然或场景光方向>\"\n"
        "光源软硬 = \"<软硬与扩散>\"\n"
        "明暗关系 = \"<主体和背景明暗层次>\"\n"
        "轮廓光 = \"<仅描述原文明确要求的轮廓光；未要求时写无额外轮廓光>\"\n"
        "主辅色 = \"<原文固有色层级；不新增具体色相>\"\n"
        "局部颜色 = \"<人物；动物或道具；环境的固有色关系>\"\n\n"
        "[拍摄参数]\n"
        "景别 = \"<景别>\"\n"
        "视角 = \"<视角>\"\n"
        "构图 = \"<构图与主体完整性>\"\n"
        "裁切 = \"<裁切边界>\"\n"
        "透视 = \"<透视>\"\n"
        "景深 = \"<景深与焦点>\"\n\n"
        "[用户附加要求]\n"
        "要求1 = \"<最终硬约束>\"\n"
        f"当前完整 Prompt：{str(current_prompt or '').strip()}\n"
        f"用户本次修改要求：{change}"
        f"{repair}"
    )


def parse_art_prompt_contract(
    raw_output: str,
    *,
    ignore_applied_requirements: bool = False,
) -> dict:
    text = str(raw_output or "").strip().lstrip("\ufeff").strip()
    payload = ""
    if text.startswith("{"):
        payload = text
    else:
        fenced = re.fullmatch(
            r"```json[ \t]*\r?\n(?P<body>[\s\S]*?)\r?\n```[ \t]*",
            text,
            flags=re.I,
        )
        if fenced:
            payload = fenced.group("body").strip()
        else:
            first_line, separator, remainder = text.partition("\n")
            preamble = first_line.rstrip("\r")
            allowed_preamble = re.fullmatch(
                r"(?:"
                r"(?:以下是|这是)\s*(?:(?:您|你)?(?:所)?(?:请求|要求|需要)的\s*|(?:优化|修改|更新)后(?:的)?\s*|最终(?:的)?\s*)?JSON(?:\s*(?:对象|结果))?[：:]?"
                r"|"
                r"Here(?:'s|\s+is)\s+(?:the\s+)?(?:(?:requested|optimized|updated|modified|final)\s+)?JSON(?:\s+(?:object|result))?[.:]?"
                r")",
                preamble,
                flags=re.I,
            )
            if separator and allowed_preamble and remainder.startswith("{"):
                payload = remainder
    if not payload:
        raise ArtPromptContractError("output must be bare JSON, a json fence, or an approved JSON preamble")
    try:
        parsed = json.loads(payload, object_pairs_hook=_reject_duplicate_pairs)
    except ArtPromptContractError:
        raise
    except json.JSONDecodeError as exc:
        raise ArtPromptContractError(
            f"invalid JSON at line {exc.lineno} column {exc.colno}: {exc.msg}"
        ) from exc
    except Exception as exc:
        raise ArtPromptContractError("invalid JSON") from exc

    root = _require_exact_keys(parsed, _TOP_LEVEL_KEYS, "root")
    if root["schema"] != SCHEMA_VERSION:
        raise ArtPromptContractError("schema mismatch")
    subject_count = root["subject_count"]
    if isinstance(subject_count, bool) or not isinstance(subject_count, int):
        raise ArtPromptContractError("subject_count must be an integer")
    if not 1 <= subject_count <= 12:
        raise ArtPromptContractError("subject_count is out of range")

    style_raw = _require_exact_keys(root["style"], _STYLE_KEYS, "style")
    style = {
        key: _clean_text(style_raw[key], f"style.{key}")
        for key in _STYLE_KEYS
    }

    subjects_raw = root["subjects"]
    if not isinstance(subjects_raw, list) or len(subjects_raw) != subject_count:
        raise ArtPromptContractError("subjects must match subject_count")
    subjects = []
    for index, value in enumerate(subjects_raw):
        path = f"subjects[{index}]"
        source = _require_exact_keys(value, _SUBJECT_KEYS, path)
        subjects.append({
            "name": _clean_text(source["name"], f"{path}.name"),
            "count": _clean_text(source["count"], f"{path}.count", limit=80),
            "appearance": _text_list(
                source["appearance"], f"{path}.appearance", max_items=10, required=True
            ),
            "pose": _clean_text(source["pose"], f"{path}.pose"),
            "action": _clean_text(source["action"], f"{path}.action"),
            "materials": _text_list(
                source["materials"], f"{path}.materials", max_items=8, required=True
            ),
            "colors": _text_list(
                source["colors"], f"{path}.colors", max_items=8, required=True
            ),
            "details": _text_list(
                source["details"], f"{path}.details", max_items=12, required=True
            ),
        })

    relations = _text_list(
        root["relations"], "relations", max_items=16, item_limit=320
    )
    if subject_count > 1 and not relations:
        relations = [
            (
                f"{subject['name'][:60]}以{subject['pose'][:80]}呈现"
                f"{subject['action'][:120]}"
            )
            for subject in subjects[:8]
        ]

    environment_raw = _require_exact_keys(
        root["environment"], _ENVIRONMENT_KEYS, "environment"
    )
    environment = {
        "setting": _clean_text(environment_raw["setting"], "environment.setting"),
        "background": _clean_text(environment_raw["background"], "environment.background"),
        "spatial_layers": _text_list(
            environment_raw["spatial_layers"],
            "environment.spatial_layers",
            max_items=8,
            required=True,
        ),
        "support_surface": _clean_text(
            environment_raw["support_surface"],
            "environment.support_surface",
            required=False,
        ),
        "occlusion": _text_list(
            environment_raw["occlusion"],
            "environment.occlusion",
            max_items=8,
        ),
    }
    if not environment["support_surface"]:
        environment["support_surface"] = (
            f"主体姿态与{environment['setting'][:300]}中的承托关系清晰稳定"
        )
    if not environment["occlusion"]:
        environment["occlusion"] = [
            "主体、服装和道具的前后遮挡清晰，"
            f"{environment['background'][:180]}保持空间层次且归属明确"
        ]

    lighting_raw = _require_exact_keys(
        root["lighting_color"], _LIGHTING_KEYS, "lighting_color"
    )
    lighting_color = {
        "light_direction": _clean_text(
            lighting_raw["light_direction"], "lighting_color.light_direction"
        ),
        "light_quality": _clean_text(
            lighting_raw["light_quality"], "lighting_color.light_quality"
        ),
        "light_shadow": _clean_text(
            lighting_raw["light_shadow"], "lighting_color.light_shadow"
        ),
        "rim_light": _clean_text(
            lighting_raw["rim_light"],
            "lighting_color.rim_light",
            required=False,
        ),
        "palette": _text_list(
            lighting_raw["palette"],
            "lighting_color.palette",
            max_items=8,
            required=True,
        ),
        "local_colors": _text_list(
            lighting_raw["local_colors"],
            "lighting_color.local_colors",
            max_items=12,
            required=True,
        ),
    }
    if not lighting_color["rim_light"]:
        lighting_color["rim_light"] = (
            f"由{lighting_color['light_direction'][:150]}与"
            f"{lighting_color['light_quality'][:150]}自然塑造主体边缘"
        )

    camera_raw = _require_exact_keys(root["camera"], _CAMERA_KEYS, "camera")
    camera = {}
    for key in _CAMERA_KEYS:
        path = f"camera.{key}"
        value = _clean_text(
            camera_raw[key],
            path,
            required=key != "crop",
        )
        if not value:
            value = f"按{camera['shot'][:300]}完整保留主体与关键动作"
        camera[key] = value
    if ignore_applied_requirements:
        raw_applied_requirements = root["applied_requirements"]
        if not isinstance(raw_applied_requirements, list):
            raise ArtPromptContractError("applied_requirements must be an array")
        if len(raw_applied_requirements) > 16:
            raise ArtPromptContractError("applied_requirements has too many items")
        applied_requirements = []
    else:
        applied_requirements = _text_list(
            root["applied_requirements"],
            "applied_requirements",
            max_items=16,
            item_limit=320,
        )
    terminal_constraints = _text_list(
        root["terminal_constraints"],
        "terminal_constraints",
        max_items=24,
        item_limit=600,
        required=True,
    )
    for index, constraint in enumerate(terminal_constraints):
        if not _TERMINAL_HARD_CONSTRAINT_PATTERN.search(constraint):
            raise ArtPromptContractError(
                f"terminal_constraints[{index}] is not a final-state hard constraint",
                code="art-prompt-contract-terminal-not-hard",
            )
    normalized = {
        "schema": SCHEMA_VERSION,
        "subject_count": subject_count,
        "style": style,
        "subjects": subjects,
        "relations": relations,
        "environment": environment,
        "lighting_color": lighting_color,
        "camera": camera,
        "applied_requirements": applied_requirements,
        "terminal_constraints": terminal_constraints,
    }
    front_values = front_five_scalar_values(normalized)
    for index, requirement in enumerate(applied_requirements):
        if requirement not in front_values:
            raise ArtPromptContractError(
                f"applied_requirements[{index}] is not an exact front-five value",
                code="art-prompt-contract-ledger-not-grounded",
            )
    _validate_object_person_consistency(normalized)
    _validate_contract_fact_quality(normalized)
    _validate_slot_semantics(normalized)
    return normalized


def parse_simple_art_prompt_contract(raw_output: str) -> dict:
    """Parse the exact six-section short-prompt model contract into nf.art.prompt.v1."""

    text = str(raw_output or "").strip().lstrip("\ufeff").strip()
    if not text or "```" in text:
        raise ArtPromptContractError(
            "simple structured output must be bare section text",
            code="art-prompt-simple-contract-invalid-envelope",
        )
    lines = [line.strip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n") if line.strip()]
    sections: dict[str, list[tuple[str, Any]]] = {}
    seen_sections: list[str] = []
    current = ""
    for line_number, line in enumerate(lines, start=1):
        if re.fullmatch(r"\[[^\]\r\n]+\]", line):
            expected = SECTIONS[len(seen_sections)] if len(seen_sections) < len(SECTIONS) else ""
            if line != expected:
                raise ArtPromptContractError(
                    f"simple structured section mismatch at line {line_number}",
                    code="art-prompt-simple-contract-section-mismatch",
                )
            seen_sections.append(line)
            sections[line] = []
            current = line
            continue
        if not current:
            raise ArtPromptContractError(
                f"simple structured preamble at line {line_number}",
                code="art-prompt-simple-contract-invalid-envelope",
            )
        match = re.fullmatch(r"([\u4e00-\u9fffA-Za-z0-9_.-]+)\s*=\s*(.+)", line)
        if not match:
            raise ArtPromptContractError(
                f"simple structured key/value invalid at line {line_number}",
                code="art-prompt-simple-contract-key-value-invalid",
            )
        key = match.group(1)
        raw_value = match.group(2).strip()
        if key == "主体数量":
            if not re.fullmatch(r"[1-6]", raw_value):
                raise ArtPromptContractError(
                    "simple structured subject count invalid",
                    code="art-prompt-simple-contract-subject-count-invalid",
                )
            value: Any = int(raw_value)
        else:
            try:
                value = json.loads(raw_value)
            except json.JSONDecodeError as exc:
                raise ArtPromptContractError(
                    f"simple structured string invalid at line {line_number}",
                    code="art-prompt-simple-contract-string-invalid",
                ) from exc
            if not isinstance(value, str) or not value.strip():
                raise ArtPromptContractError(
                    f"simple structured value empty at line {line_number}",
                    code="art-prompt-simple-contract-value-empty",
                )
            value = value.strip()
        if any(existing_key == key for existing_key, _value in sections[current]):
            raise ArtPromptContractError(
                f"simple structured duplicate key: {key}",
                code="art-prompt-simple-contract-duplicate-key",
            )
        sections[current].append((key, value))
    if tuple(seen_sections) != SECTIONS:
        raise ArtPromptContractError(
            "simple structured sections incomplete",
            code="art-prompt-simple-contract-section-mismatch",
        )

    def exact(section: str, keys: list[str]) -> dict[str, Any]:
        entries = sections.get(section) or []
        actual = [key for key, _value in entries]
        if actual != keys:
            raise ArtPromptContractError(
                f"simple structured keys mismatch: {section}",
                code="art-prompt-simple-contract-keys-mismatch",
            )
        return dict(entries)

    def items(value: str) -> list[str]:
        result = [item.strip() for item in re.split(r"[；;]", str(value or "")) if item.strip()]
        if not result:
            raise ArtPromptContractError(
                "simple structured list value empty",
                code="art-prompt-simple-contract-value-empty",
            )
        return result

    style_values = exact(SECTIONS[0], ["媒介", "绘画语言", "氛围", "完成质感"])
    subject_entries = sections.get(SECTIONS[1]) or []
    if not subject_entries or subject_entries[0][0] != "主体数量":
        raise ArtPromptContractError(
            "simple structured subject count missing",
            code="art-prompt-simple-contract-keys-mismatch",
        )
    subject_count = subject_entries[0][1]
    expected_subject_keys = ["主体数量"]
    for index in range(1, subject_count + 1):
        expected_subject_keys.extend([
            f"主体{index}",
            f"主体{index}数量",
            f"主体{index}外观",
            f"主体{index}姿态",
            f"主体{index}动作",
            f"主体{index}材质",
            f"主体{index}颜色",
            f"主体{index}局部细节",
        ])
    expected_subject_keys.append("主体关系")
    subject_values = exact(SECTIONS[1], expected_subject_keys)
    subjects = []
    simple_count_map = {
        "一": 1,
        "二": 2,
        "两": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "one": 1,
        "two": 2,
        "three": 3,
        "four": 4,
        "five": 5,
        "six": 6,
    }
    for index in range(1, subject_count + 1):
        name = subject_values[f"主体{index}"]
        count_text = subject_values[f"主体{index}数量"]
        count_match = _SIMPLE_SUBJECT_COUNT_PATTERN.fullmatch(count_text)
        if not count_match:
            raise ArtPromptContractError(
                f"simple structured subject{index} count is invalid",
                code="art-prompt-simple-contract-subject-count-invalid",
            )
        raw_count = str(count_match.group("count") or "1")
        count_value = int(raw_count) if raw_count.isdigit() else simple_count_map[raw_count]
        if _SIMPLE_SUBJECT_NAME_UNBOUNDED_COUNT_PATTERN.search(name):
            raise ArtPromptContractError(
                f"simple structured subject{index} name has an unbounded count",
                code="art-prompt-simple-contract-subject-count-invalid",
            )
        name_counts: list[int] = []
        for name_count_match in _SIMPLE_SUBJECT_NAME_EXPLICIT_COUNT_PATTERN.finditer(name):
            if name_count_match.group("pair") or name_count_match.group("twins"):
                name_counts.append(2)
                continue
            raw_name_count = str(
                name_count_match.group("count")
                or name_count_match.group("english")
                or "1"
            ).lower()
            name_counts.append(
                int(raw_name_count)
                if raw_name_count.isdigit()
                else simple_count_map[raw_name_count]
            )
        if len(name_counts) != 1:
            raise ArtPromptContractError(
                f"simple structured subject{index} name must contain exactly one bounded count",
                code="art-prompt-simple-contract-subject-count-invalid",
            )
        if _SIMPLE_SUBJECT_NAME_PLURAL_SEMANTICS_PATTERN.search(name) and name_counts[0] <= 1:
            raise ArtPromptContractError(
                f"simple structured subject{index} name has unbounded plural semantics",
                code="art-prompt-simple-contract-subject-count-invalid",
            )
        if name_counts and any(name_count != count_value for name_count in name_counts):
            raise ArtPromptContractError(
                f"simple structured subject{index} name/count mismatch",
                code="art-prompt-simple-contract-subject-count-invalid",
            )
        subjects.append({
            "name": name,
            "count": count_text,
            "appearance": items(subject_values[f"主体{index}外观"]),
            "pose": subject_values[f"主体{index}姿态"],
            "action": subject_values[f"主体{index}动作"],
            "materials": items(subject_values[f"主体{index}材质"]),
            "colors": items(subject_values[f"主体{index}颜色"]),
            "details": items(subject_values[f"主体{index}局部细节"]),
        })
    relation_text = subject_values["主体关系"]
    relations = [] if subject_count == 1 and re.search(r"单主体|无额外主体关系", relation_text) else items(relation_text)
    environment_values = exact(
        SECTIONS[2],
        ["环境", "背景", "前中后景", "承托面", "遮挡层次"],
    )
    lighting_values = exact(
        SECTIONS[3],
        ["光源方向", "光源软硬", "明暗关系", "轮廓光", "主辅色", "局部颜色"],
    )
    camera_values = exact(
        SECTIONS[4],
        ["景别", "视角", "构图", "裁切", "透视", "景深"],
    )
    requirement_entries = sections.get(SECTIONS[5]) or []
    requirement_keys = [key for key, _value in requirement_entries]
    if not requirement_keys or requirement_keys != [
        f"要求{index}" for index in range(1, len(requirement_keys) + 1)
    ]:
        raise ArtPromptContractError(
            "simple structured requirement keys mismatch",
            code="art-prompt-simple-contract-keys-mismatch",
        )
    contract = {
        "schema": SCHEMA_VERSION,
        "subject_count": subject_count,
        "style": {
            "medium": style_values["媒介"],
            "render_language": style_values["绘画语言"],
            "atmosphere": style_values["氛围"],
            "finish": style_values["完成质感"],
        },
        "subjects": subjects,
        "relations": relations,
        "environment": {
            "setting": environment_values["环境"],
            "background": environment_values["背景"],
            "spatial_layers": items(environment_values["前中后景"]),
            "support_surface": environment_values["承托面"],
            "occlusion": items(environment_values["遮挡层次"]),
        },
        "lighting_color": {
            "light_direction": lighting_values["光源方向"],
            "light_quality": lighting_values["光源软硬"],
            "light_shadow": lighting_values["明暗关系"],
            "rim_light": lighting_values["轮廓光"],
            "palette": items(lighting_values["主辅色"]),
            "local_colors": items(lighting_values["局部颜色"]),
        },
        "camera": {
            "shot": camera_values["景别"],
            "angle": camera_values["视角"],
            "composition": camera_values["构图"],
            "crop": camera_values["裁切"],
            "perspective": camera_values["透视"],
            "depth_of_field": camera_values["景深"],
        },
        "applied_requirements": [],
        "terminal_constraints": [value for _key, value in requirement_entries],
    }
    normalized = parse_art_prompt_contract(
        json.dumps(contract, ensure_ascii=False, separators=(",", ":")),
        ignore_applied_requirements=True,
    )
    _validate_simple_light_slot_semantics(normalized)
    return normalized


def front_five_scalar_values(contract: dict) -> list[str]:
    values: list[str] = []

    def collect(value: Any) -> None:
        if isinstance(value, str):
            values.append(value)
        elif isinstance(value, list):
            for item in value:
                collect(item)
        elif isinstance(value, dict):
            for item in value.values():
                collect(item)

    for key in (
        "style",
        "subjects",
        "relations",
        "environment",
        "lighting_color",
        "camera",
    ):
        collect(contract[key])
    return values


def _normalized_fact_key(value: str) -> str:
    return re.sub(
        r"[^\u4e00-\u9fffA-Za-z0-9]+",
        "",
        str(value or ""),
    ).lower()


_PERSON_SUBJECT_NAME_PATTERN = re.compile(
    r"(?:人物|角色|女性|男性|女人|男人|女子|男子|女士|男士|女孩|男孩|"
    r"少女|少年|美女|女郎|骑士|武士|战士)"
    r"|(?<![a-z0-9_])(?:person|character|woman|women|man|men|female|male|"
    r"lady|gentleman|girl|boy|knight|warrior)(?![a-z0-9_])",
    re.I,
)
_OBJECT_PERSON_APPEARANCE_PATTERN = re.compile(
    r"(?:人体|人物身体|女性身体|男性身体|裸体|裸露|乳房|乳头|胸部|脸部|面部|"
    r"五官|手臂|双腿|人体比例)"
    r"|(?<![a-z0-9_])(?:human[-\s]+body|woman(?:'s)?[-\s]+body|"
    r"man(?:'s)?[-\s]+body|nude|naked|breasts?|nipples?|facial[-\s]+features|"
    r"human[-\s]+face|human[-\s]+arms?|human[-\s]+legs?)(?![a-z0-9_])",
    re.I,
)
_OBJECT_PERSON_CAMERA_PATTERN = re.compile(
    r"(?:全身肖像|半身肖像|人物全身|人物半身|人物特写|人像摄影|胸像|头像特写)"
    r"|(?<![a-z0-9_])(?:(?<!product\s)(?<!object\s)portrait|"
    r"full[-\s]+body(?:[-\s]+portrait)?|half[-\s]+body(?:[-\s]+portrait)?|"
    r"headshot|bust[-\s]+shot)(?![a-z0-9_])",
    re.I,
)


def _validate_object_person_consistency(contract: dict) -> None:
    if any(
        _PERSON_SUBJECT_NAME_PATTERN.search(str(subject.get("name") or ""))
        for subject in contract["subjects"]
    ):
        return
    appearance_text = "\n".join(
        str(item or "")
        for subject in contract["subjects"]
        for item in subject.get("appearance", [])
    )
    camera_text = "\n".join(
        str(value or "")
        for value in contract["camera"].values()
    )
    if (
        _OBJECT_PERSON_APPEARANCE_PATTERN.search(appearance_text)
        or _OBJECT_PERSON_CAMERA_PATTERN.search(camera_text)
    ):
        raise ArtPromptContractError(
            "object-only subjects contain person-specific appearance or camera facts",
            code="art-prompt-contract-object-person-inconsistent",
        )


def _fact_keys(value: Any) -> set[str]:
    result: set[str] = set()
    if isinstance(value, str):
        key = _normalized_fact_key(value)
        if key:
            result.add(key)
    elif isinstance(value, list):
        for item in value:
            result.update(_fact_keys(item))
    elif isinstance(value, dict):
        for item in value.values():
            result.update(_fact_keys(item))
    return result


def _shareable_duplicate_fact(key: str) -> bool:
    if len(key) < 4:
        return True
    if re.fullmatch(
        r"(?:(?:一|两|三|四|五|六|七|八|九|十|\d+)(?:位|名)?|\d+岁以上|"
        r"成年|成人|东方|亚洲|女性|男性|人物|角色|女人|男人|女子|男子|"
        r"adult|asian|east|woman|women|man|men|female|male|person|character)+",
        key,
        re.I,
    ):
        return True
    return bool(re.fullmatch(
        r"(?:浅|淡|深|暖|冷|亮|暗|红|橙|黄|绿|青|蓝|紫|黑|白|灰|金|银|"
        r"粉|棕|褐|米|象牙|色|light|dark|warm|cool|red|orange|yellow|green|"
        r"cyan|blue|purple|black|white|gray|grey|gold|silver|pink|brown)+",
        key,
        re.I,
    ))


def _validate_contract_fact_quality(contract: dict) -> None:
    occurrences: dict[str, set[tuple[str, str]]] = {}

    def collect(section: str, path: str, value: Any) -> None:
        if isinstance(value, str):
            key = _normalized_fact_key(value)
            if key and not _shareable_duplicate_fact(key):
                occurrences.setdefault(key, set()).add((section, path))
        elif isinstance(value, list):
            for item in value:
                collect(section, path, item)
        elif isinstance(value, dict):
            for name, item in value.items():
                collect(section, f"{path}.{name}", item)

    collect("style", "style", contract["style"])
    for index, subject in enumerate(contract["subjects"]):
        collect("subjects", f"subjects[{index}]", subject)
    collect("subjects", "relations", contract["relations"])
    collect("environment", "environment", contract["environment"])
    collect("lighting_color", "lighting_color", contract["lighting_color"])
    collect("camera", "camera", contract["camera"])
    for key, slots in occurrences.items():
        sections = {section for section, _path in slots}
        if len(slots) >= 5 or (len(slots) >= 4 and len(sections) >= 3):
            raise ArtPromptContractError(
                f"front-five fact is repeated across unrelated slots: {key[:80]}",
                code="art-prompt-contract-duplicate-facts",
            )

    minimums = (
        ("style", contract["style"], 3),
        ("environment", contract["environment"], 3),
        ("lighting_color", contract["lighting_color"], 3),
        ("camera", contract["camera"], 4),
    )
    for section, value, minimum in minimums:
        count = len(_fact_keys(value))
        if count < minimum:
            raise ArtPromptContractError(
                f"{section} has too few independent facts: {count}/{minimum}",
                code="art-prompt-contract-insufficient-independent-facts",
            )
    for index, subject in enumerate(contract["subjects"]):
        count = len(_fact_keys(subject))
        if count < 4:
            raise ArtPromptContractError(
                f"subjects[{index}] has too few independent facts: {count}/4",
                code="art-prompt-contract-insufficient-independent-facts",
            )


def _quoted(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _joined(values: list[str]) -> str:
    return "；".join(values)


def compile_art_prompt_contract(contract: dict) -> str:
    normalized = parse_art_prompt_contract(
        json.dumps(contract, ensure_ascii=False, separators=(",", ":"))
    )
    style = normalized["style"]
    environment = normalized["environment"]
    lighting = normalized["lighting_color"]
    camera = normalized["camera"]

    style_lines = [
        f"媒介 = {_quoted(style['medium'])}",
        f"绘画语言 = {_quoted(style['render_language'])}",
        f"氛围 = {_quoted(style['atmosphere'])}",
        f"完成质感 = {_quoted(style['finish'])}",
    ]
    subject_lines = [f"主体数量 = {normalized['subject_count']}"]
    for index, subject in enumerate(normalized["subjects"], start=1):
        prefix = f"主体{index}"
        subject_lines.extend([
            f"{prefix} = {_quoted(subject['name'])}",
            f"{prefix}数量 = {_quoted(subject['count'])}",
            f"{prefix}外观 = {_quoted(_joined(subject['appearance']))}",
            f"{prefix}姿态 = {_quoted(subject['pose'])}",
            f"{prefix}动作 = {_quoted(subject['action'])}",
            f"{prefix}材质 = {_quoted(_joined(subject['materials']))}",
            f"{prefix}颜色 = {_quoted(_joined(subject['colors']))}",
            f"{prefix}局部细节 = {_quoted(_joined(subject['details']))}",
        ])
    subject_lines.append(
        f"主体关系 = {_quoted(_joined(normalized['relations']) if normalized['relations'] else '单主体，无额外主体关系')}"
    )
    environment_lines = [
        f"环境 = {_quoted(environment['setting'])}",
        f"背景 = {_quoted(environment['background'])}",
        f"前中后景 = {_quoted(_joined(environment['spatial_layers']))}",
        f"承托面 = {_quoted(environment['support_surface'])}",
        f"遮挡层次 = {_quoted(_joined(environment['occlusion']))}",
    ]
    lighting_lines = [
        f"光源方向 = {_quoted(lighting['light_direction'])}",
        f"光源软硬 = {_quoted(lighting['light_quality'])}",
        f"明暗关系 = {_quoted(lighting['light_shadow'])}",
        f"轮廓光 = {_quoted(lighting['rim_light'])}",
        f"主辅色 = {_quoted(_joined(lighting['palette']))}",
        f"局部颜色 = {_quoted(_joined(lighting['local_colors']))}",
    ]
    camera_lines = [
        f"景别 = {_quoted(camera['shot'])}",
        f"视角 = {_quoted(camera['angle'])}",
        f"构图 = {_quoted(camera['composition'])}",
        f"裁切 = {_quoted(camera['crop'])}",
        f"透视 = {_quoted(camera['perspective'])}",
        f"景深 = {_quoted(camera['depth_of_field'])}",
    ]
    constraints = normalized["terminal_constraints"]
    constraint_lines = [
        f"要求{index} = {_quoted(value)}"
        for index, value in enumerate(constraints, start=1)
    ]
    sections = (
        (SECTIONS[0], style_lines),
        (SECTIONS[1], subject_lines),
        (SECTIONS[2], environment_lines),
        (SECTIONS[3], lighting_lines),
        (SECTIONS[4], camera_lines),
        (SECTIONS[5], constraint_lines),
    )
    result = "\n\n".join(
        f"{header}\n" + "\n".join(lines)
        for header, lines in sections
    )
    if tuple(
        line.strip()
        for line in result.splitlines()
        if line.strip().startswith("[") and line.strip().endswith("]")
    ) != SECTIONS:
        raise ArtPromptContractError("compiled sections mismatch")
    if len(re.sub(r"\s+", "", result)) < 300:
        raise ArtPromptContractError("compiled prompt is too short")
    return result


def front_five_sections(compiled_prompt: str) -> str:
    marker = f"\n\n{SECTIONS[5]}\n"
    text = str(compiled_prompt or "").strip()
    if marker not in text:
        raise ArtPromptContractError("terminal constraint section missing")
    return text.split(marker, 1)[0].strip()


def terminal_constraint_text(contract: dict) -> str:
    return "\n".join(
        str(item or "").strip()
        for item in contract.get("terminal_constraints", [])
        if str(item or "").strip()
    )
