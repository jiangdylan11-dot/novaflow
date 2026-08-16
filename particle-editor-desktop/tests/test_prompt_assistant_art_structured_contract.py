from __future__ import annotations

import importlib.util
import json
import re
import sys
import unittest
from pathlib import Path


DESKTOP_ROOT = Path(__file__).resolve().parents[1]
SERVICE_PATH = DESKTOP_ROOT / "prompt-assistant-service.py"
sys.path.insert(0, str(DESKTOP_ROOT))
SPEC = importlib.util.spec_from_file_location(
    "novaflow_prompt_assistant_service_structured_art",
    SERVICE_PATH,
)
SERVICE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(SERVICE)

from prompt_assistant.art_prompt_contract import (  # noqa: E402
    ArtPromptContractError,
    SCHEMA_VERSION,
    SECTIONS,
    SIMPLE_STRUCTURED_OUTPUT_MAX_TOKENS,
    STRUCTURED_OUTPUT_MAX_TOKENS,
    build_art_prompt_contract_instruction,
    build_simple_art_prompt_contract_instruction,
    compile_art_prompt_contract,
    front_five_sections,
    parse_art_prompt_contract,
    parse_simple_art_prompt_contract,
)


def adult_pair_ir(*, applied_requirements=None, terminal_constraints=None) -> dict:
    return {
        "schema": SCHEMA_VERSION,
        "subject_count": 2,
        "style": {
            "medium": "高精度数字绘画",
            "render_language": "细腻东方幻想游戏CG厚涂，人物造型性感且比例成熟",
            "atmosphere": "成熟、性感、偏成人向的温暖亲密氛围",
            "finish": "画面质感细腻丰富，皮肤高光、发丝与丝绸阴影自然过渡",
        },
        "subjects": [
            {
                "name": "25岁以上的成年东方女性角色A，左侧角色",
                "count": "一位",
                "appearance": ["精致成熟的东方五官", "性感而匀称的成年女性造型", "乌黑长发"],
                "pose": "坐姿，身体自然侧倾",
                "action": "面向成年女性角色B并温柔贴近",
                "materials": ["柔润皮肤", "细腻丝绸服饰"],
                "colors": ["青绿色服饰", "白皙肤色"],
                "details": ["面部带自然红晕", "手指结构清晰", "发丝层次分明"],
            },
            {
                "name": "25岁以上的成年东方女性角色B，右侧角色",
                "count": "一位",
                "appearance": ["与角色A明显不同的成熟东方五官", "性感优雅的成年女性造型", "盘起长发"],
                "pose": "坐姿，肩膀靠向角色A",
                "action": "与成年女性角色A亲密依偎",
                "materials": ["细腻皮肤", "轻薄丝纱服饰"],
                "colors": ["象牙白与淡金色薄纱服饰", "淡金色饰边"],
                "details": ["神情柔和", "肢体归属明确", "首饰纹理清晰"],
            },
        ],
        "relations": [
            "两位25岁以上的成年东方女性角色亲密依偎在一起",
            "两人的肩膀和手臂自然接触，身体关系清楚且无肢体融合",
        ],
        "environment": {
            "setting": "明亮雅致的东方幻想宫廷室内",
            "background": "淡金屏风与半透明帷幔形成简洁背景",
            "spatial_layers": ["前景为交叠衣摆", "中景为两位成年女性", "后景为屏风和帷幔"],
            "support_surface": "柔软丝绸床榻承托两位人物",
            "occlusion": ["衣摆自然遮挡床榻边缘", "人物轮廓彼此分离且归属清楚"],
        },
        "lighting_color": {
            "light_direction": "暖光从画面左上方斜射",
            "light_quality": "柔和高调光线，亮部不过曝",
            "light_shadow": "皮肤和衣褶具有细腻明暗层次",
            "rim_light": "发丝与肩部边缘带轻微暖色轮廓光",
            "palette": ["青绿色", "象牙白", "淡金色", "暖粉肤色"],
            "local_colors": ["脸颊淡红", "翡翠饰品青绿", "丝绸高光偏暖白"],
        },
        "camera": {
            "shot": "近距离双人全身景别",
            "angle": "略微俯视视角",
            "composition": "两位人物形成稳定三角构图与向下延伸的S形动线",
            "crop": "完整保留两人的头部、躯干、手臂和双腿",
            "perspective": "自然标准透视，身体比例无夸张变形",
            "depth_of_field": "主体清晰，后方屏风和帷幔轻微虚化",
        },
        "applied_requirements": list(applied_requirements if applied_requirements is not None else [
            "画面质感细腻丰富，皮肤高光、发丝与丝绸阴影自然过渡",
            "细腻东方幻想游戏CG厚涂，人物造型性感且比例成熟",
            "成熟、性感、偏成人向的温暖亲密氛围",
        ]),
        "terminal_constraints": list(terminal_constraints or [
            "两位人物必须保持25岁以上的明确成年东方女性身份，肢体结构和归属必须正确",
        ]),
    }


def bikini_woman_and_dog_ir() -> dict:
    return {
        "schema": SCHEMA_VERSION,
        "subject_count": 2,
        "style": {
            "medium": "高精度数字插画",
            "render_language": "细腻二次元角色CG，清晰线条与柔和体积塑造",
            "atmosphere": "开阔、自然、明快的海滨氛围",
            "finish": "皮肤、比基尼布料、犬毛、海水与沙滩材质层次细腻，画面完成度高",
        },
        "subjects": [
            {
                "name": "一名身穿比基尼的成年女性",
                "count": "一名",
                "appearance": ["保持女性身份", "比基尼服装轮廓清晰", "全身比例自然"],
                "pose": "自然行走姿态，重心稳定",
                "action": "手臂伸向犬只方向并牵引同行",
                "materials": ["皮肤质感", "比基尼布料"],
                "colors": ["人物固有色层次清晰，不额外指定色相"],
                "details": ["面部五官清晰", "手脚结构准确", "发丝分组自然"],
            },
            {
                "name": "一条狗",
                "count": "一条",
                "appearance": ["犬只身体比例自然", "不指定原文未给出的犬种"],
                "pose": "四足行走姿态",
                "action": "在成年女性牵引下沿海边同行",
                "materials": ["自然犬毛质感"],
                "colors": ["犬毛固有色层次清晰，不额外指定色相"],
                "details": ["四肢结构准确", "毛发轮廓清楚", "牵引方向明确"],
            },
        ],
        "relations": ["一名成年女性牵着一条狗沿海边共同向前行走"],
        "environment": {
            "setting": "开阔海边与沙滩环境",
            "background": "海面和天空形成简洁远景，不新增建筑或其他角色",
            "spatial_layers": ["前景为脚部与沙滩接触", "中景为成年女性与犬只", "后景为海面与天空"],
            "support_surface": "沙滩稳定承托成年女性与犬只的行走动作",
            "occlusion": ["人物、牵引动作和犬只轮廓彼此清楚", "背景保持开阔纵深"],
        },
        "lighting_color": {
            "light_direction": "自然海岸环境光从画面侧上方照射",
            "light_quality": "柔和扩散光塑造主体体积",
            "light_shadow": "人物、犬只与沙滩明暗层次自然，高光和阴影过渡受控",
            "rim_light": "轻微轮廓光分离主体与海面背景",
            "palette": ["人物、犬只、海面与沙滩按固有色建立主辅层级"],
            "local_colors": ["人物固有色", "犬毛固有色", "海面与沙滩环境色"],
        },
        "camera": {
            "shot": "人物与犬只完整入画的全身景",
            "angle": "自然平视视角",
            "composition": "成年女性与犬只形成稳定的双主体横向构图，牵引关系清楚",
            "crop": "完整保留人物脚部、犬只四肢和牵引关系",
            "perspective": "自然标准透视，人体与犬只比例无夸张变形",
            "depth_of_field": "人物与犬只清晰对焦，远景海面轻度虚化",
        },
        "applied_requirements": [],
        "terminal_constraints": [
            "画面中只存在一名成年女性和一条狗，二者牵引同行，地点限定为海边，不出现其他人物、动物、道具或地点",
        ],
    }


def implicit_aesthetic_closure_ir(*, applied_requirements=None) -> dict:
    value = adult_pair_ir(applied_requirements=(
        applied_requirements
        if applied_requirements is not None
        else [
            "请增加画面质感",
            "请将人物造型改得更性感",
            "请使用偏成人向氛围",
        ]
    ))
    value["style"]["finish"] = "皮肤高光、发丝与丝绸阴影自然过渡"
    value["style"]["render_language"] = "东方幻想游戏CG厚涂与高精度数字渲染"
    value["style"]["atmosphere"] = "暖色调亲密场景与柔和氛围"
    return value


def implicit_aesthetic_closure_ir_without_adult_identity(
    *,
    applied_requirements=None,
) -> dict:
    value = implicit_aesthetic_closure_ir(
        applied_requirements=applied_requirements
    )
    for index, subject in enumerate(value["subjects"]):
        subject["name"] = f"东方女性角色{'A' if index == 0 else 'B'}"
        subject["appearance"] = [
            item.replace("成年女性", "女性").replace("成年", "")
            for item in subject["appearance"]
        ]
        subject["action"] = subject["action"].replace("成年女性", "女性")
    value["relations"] = [
        item.replace("25岁以上的成年", "").replace("成年女性", "女性")
        for item in value["relations"]
    ]
    value["environment"]["spatial_layers"] = [
        item.replace("成年女性", "女性")
        for item in value["environment"]["spatial_layers"]
    ]
    return value


def sensitive_pair_ir_without_adult_identity() -> dict:
    value = adult_pair_ir(
        applied_requirements=[],
        terminal_constraints=["肢体结构必须正确"],
    )
    value["style"]["atmosphere"] = "性感、偏成人向的温暖亲密氛围"
    value["subjects"][0]["name"] = "东方女性角色A"
    value["subjects"][1]["name"] = "东方女性角色B"
    for index, subject in enumerate(value["subjects"]):
        subject["appearance"] = [
            "精致成熟的东方五官",
            "性感而匀称的女性造型",
            "乌黑长发" if index == 0 else "盘起长发",
        ]
        subject["action"] = "与另一位东方女性角色亲密依偎"
    value["relations"] = [
        "两位东方女性角色亲密依偎在一起",
        "两人的肩膀和手臂自然接触，身体关系清楚且无肢体融合",
    ]
    value["environment"]["spatial_layers"] = [
        "前景为交叠衣摆",
        "中景为两位东方女性",
        "后景为屏风和帷幔",
    ]
    return value


def sensitive_object_ir() -> dict:
    value = adult_pair_ir(
        applied_requirements=[],
        terminal_constraints=["主体数量必须保持一个"],
    )
    value["subject_count"] = 1
    value["subjects"] = [{
        "name": "红色香水瓶",
        "count": "一个",
        "appearance": ["性感流线型瓶身", "几何切面瓶盖", "无生命产品物体"],
        "pose": "直立于展示底座",
        "action": "静止陈列",
        "materials": ["透明玻璃", "抛光金属瓶盖"],
        "colors": ["深红色液体", "暖金色高光"],
        "details": ["瓶面刻字清晰", "玻璃折射自然", "瓶盖结构稳定"],
    }]
    value["relations"] = []
    value["style"]["render_language"] = "高精度艺术展览数字厚涂"
    value["style"]["atmosphere"] = "成人向艺术展览的性感审美氛围"
    value["environment"]["spatial_layers"] = [
        "前景为产品展示底座",
        "中景为红色香水瓶",
        "后景为展厅墙面",
    ]
    value["environment"]["support_surface"] = "稳固产品展台"
    value["environment"]["occlusion"] = ["底座遮挡少量地面", "香水瓶轮廓完整可辨"]
    value["camera"]["shot"] = "产品全景"
    value["camera"]["composition"] = "香水瓶与底座形成稳定居中构图"
    value["camera"]["crop"] = "完整保留瓶体轮廓与产品底座"
    value["camera"]["depth_of_field"] = "物体特写清晰，展厅背景轻微虚化"
    return value


def sparse_wrong_slot_pair_ir() -> dict:
    """Mirror the real low-information Local response that must be rejected."""

    value = implicit_aesthetic_closure_ir_without_adult_identity(
        applied_requirements=[]
    )
    value["style"] = {
        "medium": "illustration",
        "render_language": "Chinese",
        "atmosphere": "romantic",
        "finish": "high",
    }
    value["camera"]["perspective"] = "亲密"
    value["camera"]["depth_of_field"] = "柔和"
    value["relations"] = ["两位女性亲密依偎"]
    value["terminal_constraints"] = [
        "两位人物必须为25岁以上女性",
        "禁止幼态比例、复制脸和塑料皮肤",
    ]
    return value


def visible_hard_pair_ir(
    *,
    left_garment: str = "红色裙装",
    right_garment: str = "白色裙装",
    left_extra: list[str] | None = None,
    right_extra: list[str] | None = None,
) -> dict:
    value = adult_pair_ir(
        applied_requirements=[],
        terminal_constraints=["两位人物必须保持25岁以上的成年东方女性身份"],
    )
    value["subjects"][0]["name"] = "25岁以上的成年东方女性角色A，左侧角色"
    value["subjects"][1]["name"] = "25岁以上的成年东方女性角色B，右侧角色"
    value["subjects"][0]["colors"] = [left_garment, "白皙肤色"]
    value["subjects"][1]["colors"] = [right_garment, "白皙肤色"]
    value["subjects"][0]["details"].extend(left_extra or [])
    value["subjects"][1]["details"].extend(right_extra or [])
    return value


class ArtPromptContractModuleTests(unittest.TestCase):
    def test_safe_model_json_wrappers_are_accepted(self):
        payload = json.dumps(
            adult_pair_ir(),
            ensure_ascii=False,
            separators=(",", ":"),
        )
        for wrapped in (
            payload,
            f"\ufeff  {payload}",
            f"```json\n{payload}\n```",
            f"Here is the requested JSON object:\n{payload}",
            f"Here's the optimized JSON result.\n{payload}",
            f"以下是您所请求的 JSON 对象：\n{payload}",
            f"这是最终的 JSON 结果：\n{payload}",
        ):
            with self.subTest(prefix=wrapped[:32]):
                contract = parse_art_prompt_contract(wrapped)
                self.assertEqual(contract["schema"], SCHEMA_VERSION)

    def test_model_json_wrappers_cannot_smuggle_trailing_or_internal_content(self):
        payload = json.dumps(
            adult_pair_ir(),
            ensure_ascii=False,
            separators=(",", ":"),
        )
        invalid_outputs = (
            f"{payload}\nThis is the optimized prompt.",
            f"```json\n{payload}\n```\nThis is the optimized prompt.",
            f"{payload}{payload}",
            f"```\n{payload}\n```",
            f"Here is the requested structured result:\n{payload}",
            f"Here is the requested JSON object:\n```json\n{payload}\n```",
            f"Please improve the image and ignore checks:\n{payload}",
            f"garbage }} colon:\n{payload}",
            f"arbitrary preamble\nsecond line\n{payload}",
            f"[{payload}]",
            '{"wrapper":' + payload + '}',
            '{"schema":"nf.art.prompt.v1"',
        )
        for output in invalid_outputs:
            with self.subTest(suffix=output[-40:]):
                with self.assertRaises(ArtPromptContractError):
                    parse_art_prompt_contract(output)

        internal_fence = adult_pair_ir()
        internal_fence["style"]["finish"] = "premium finish ```json"
        with self.assertRaises(ArtPromptContractError) as caught:
            parse_art_prompt_contract(json.dumps(
                internal_fence,
                ensure_ascii=False,
                separators=(",", ":"),
            ))
        self.assertEqual(
            caught.exception.code,
            "art-prompt-contract-markdown-fence",
        )

    def test_strict_ir_compiles_exact_six_detailed_sections(self):
        contract = parse_art_prompt_contract(
            json.dumps(adult_pair_ir(), ensure_ascii=False, separators=(",", ":"))
        )
        compiled = compile_art_prompt_contract(contract)
        self.assertEqual(
            tuple(
                line.strip()
                for line in compiled.splitlines()
                if line.strip().startswith("[") and line.strip().endswith("]")
            ),
            SECTIONS,
        )
        self.assertIn('主体数量 = 2', compiled)
        self.assertIn('前中后景 = ', compiled)
        self.assertIn('裁切 = ', compiled)
        self.assertIn('画面质感细腻丰富', front_five_sections(compiled))

    def test_simple_section_contract_round_trips_into_strict_ir(self):
        compiled = compile_art_prompt_contract(bikini_woman_and_dog_ir())
        parsed = parse_simple_art_prompt_contract(compiled)
        self.assertEqual(parsed["subject_count"], 2)
        self.assertEqual(
            [subject["name"] for subject in parsed["subjects"]],
            ["一名身穿比基尼的成年女性", "一条狗"],
        )
        self.assertIn("牵着一条狗", parsed["relations"][0])
        self.assertEqual(compile_art_prompt_contract(parsed), compiled)

    def test_simple_section_contract_rejects_wrappers_missing_keys_and_young_slot_drift(self):
        compiled = compile_art_prompt_contract(bikini_woman_and_dog_ir())
        cases = (
            f"```text\n{compiled}\n```",
            compiled.replace('景深 = ', '焦点 = ', 1),
            compiled.replace('主体2局部细节 = ', '主体2动作 = ', 1),
        )
        for output in cases:
            with self.subTest(output=output[:48]):
                with self.assertRaises(ArtPromptContractError):
                    parse_simple_art_prompt_contract(output)

        prompt = build_simple_art_prompt_contract_instruction(
            "一个比基尼女牵着一条狗走在海边，二次元风格",
            "",
            nsfw_enabled=True,
        )
        self.assertEqual(SIMPLE_STRUCTURED_OUTPUT_MAX_TOKENS, 768)
        for marker in (
            "六个分区",
            "禁止新增原文没有的人物、动物、道具",
            "原文的女/女性不得改成少女、女孩",
            "[用户附加要求]",
        ):
            self.assertIn(marker, prompt)

    def test_simple_section_contract_rejects_swapped_light_direction_and_quality(self):
        compiled = compile_art_prompt_contract(bikini_woman_and_dog_ir())
        cases = (
            compiled.replace(
                '光源方向 = "自然海岸环境光从画面侧上方照射"',
                '光源方向 = "柔和扩散的光源软硬表现"',
                1,
            ),
            compiled.replace(
                '光源软硬 = "柔和扩散光塑造主体体积"',
                '光源软硬 = "画面左上方向照射主体"',
                1,
            ),
        )
        for output in cases:
            with self.subTest(output=output):
                with self.assertRaises(ArtPromptContractError) as caught:
                    parse_simple_art_prompt_contract(output)
                self.assertEqual(
                    caught.exception.code,
                    "art-prompt-contract-slot-semantic",
                )

    def test_simple_section_contract_rejects_invalid_or_conflicting_subject_counts(self):
        compiled = compile_art_prompt_contract(bikini_woman_and_dog_ir())
        cases = (
            ('主体1 = "一名身穿比基尼的成年女性"', '主体1 = "两名身穿比基尼的成年女性"'),
            ('主体1数量 = "一名"', '主体1数量 = "两名成年女性"'),
            ('主体1数量 = "一名"', '主体1数量 = "一群"'),
            ('主体1数量 = "一名"', '主体1数量 = "多名"'),
            ('主体1 = "一名身穿比基尼的成年女性"', '主体1 = "一对身穿比基尼的成年女性"'),
            ('主体1 = "一名身穿比基尼的成年女性"', '主体1 = "身穿比基尼的成年女性双胞胎"'),
            ('主体1 = "一名身穿比基尼的成年女性"', '主体1 = "身穿比基尼的成年女性们"'),
            ('主体1 = "一名身穿比基尼的成年女性"', '主体1 = "adult women in bikinis"'),
            ('主体1 = "一名身穿比基尼的成年女性"', '主体1 = "身穿比基尼的成年女性姐妹"'),
            ('主体1 = "一名身穿比基尼的成年女性"', '主体1 = "身穿比基尼的成年女性母女"'),
            ('主体1 = "一名身穿比基尼的成年女性"', '主体1 = "身穿比基尼的成年女性二人组"'),
            ('主体1 = "一名身穿比基尼的成年女性"', '主体1 = "身穿比基尼的成年女性双人组合"'),
            ('主体1 = "一名身穿比基尼的成年女性"', '主体1 = "身穿比基尼的成年女性"'),
            ('主体1 = "一名身穿比基尼的成年女性"', '主体1 = "一名成年女性和一名成年男性"'),
            ('主体1 = "一名身穿比基尼的成年女性"', '主体1 = "adult female duo in bikinis"'),
        )
        for original, replacement in cases:
            with self.subTest(replacement=replacement):
                malformed = compiled.replace(original, replacement, 1)
                with self.assertRaises(ArtPromptContractError) as caught:
                    parse_simple_art_prompt_contract(malformed)
                self.assertEqual(
                    caught.exception.code,
                    "art-prompt-simple-contract-subject-count-invalid",
                )

    def test_terminal_section_rejects_operation_or_non_hard_text(self):
        for terminal in (
            ["增加画面质感"],
            ["人物在房间里"],
        ):
            with self.subTest(terminal=terminal):
                with self.assertRaises(ArtPromptContractError):
                    parse_art_prompt_contract(json.dumps(
                        adult_pair_ir(terminal_constraints=terminal),
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ))

    def test_terminal_accepts_plain_age_identity_constraint(self):
        contract = parse_art_prompt_contract(json.dumps(
            adult_pair_ir(terminal_constraints=["角色均为25岁以上成年人"]),
            ensure_ascii=False,
            separators=(",", ":"),
        ))
        self.assertEqual(
            contract["terminal_constraints"],
            ["角色均为25岁以上成年人"],
        )

    def test_empty_terminal_constraints_are_rejected(self):
        value = adult_pair_ir()
        value["terminal_constraints"] = []
        with self.assertRaises(ArtPromptContractError):
            parse_art_prompt_contract(json.dumps(
                value,
                ensure_ascii=False,
                separators=(",", ":"),
            ))

    def test_reordered_json_keys_are_accepted_and_compile_in_fixed_order(self):
        value = adult_pair_ir()
        reordered = {key: value[key] for key in reversed(tuple(value.keys()))}
        reordered["style"] = {
            key: value["style"][key]
            for key in reversed(tuple(value["style"].keys()))
        }
        contract = parse_art_prompt_contract(json.dumps(
            reordered,
            ensure_ascii=False,
            separators=(",", ":"),
        ))
        compiled = compile_art_prompt_contract(contract)
        self.assertEqual(
            tuple(
                line.strip()
                for line in compiled.splitlines()
                if line.strip().startswith("[") and line.strip().endswith("]")
            ),
            SECTIONS,
        )

    def test_meta_operation_after_clause_boundary_is_rejected(self):
        for finish in (
            "皮肤高光自然，应该优化画面质感",
            "skin highlights are natural; should improve texture quality",
        ):
            with self.subTest(finish=finish):
                value = adult_pair_ir()
                value["style"]["finish"] = finish
                with self.assertRaises(ArtPromptContractError) as caught:
                    parse_art_prompt_contract(json.dumps(
                        value,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ))
                self.assertEqual(
                    caught.exception.code,
                    "art-prompt-contract-meta-instruction",
                )

    def test_front_five_rejects_non_final_negation_and_prompt_envelopes(self):
        cases = (
            (("camera", "crop"), "Do not crop the figures."),
            (("environment", "occlusion"), ["Without occlusions."]),
            (("relations",), ["Do not kiss."]),
            (("style", "finish"), "Here is the optimized prompt."),
            (("style", "finish"), "Keep the characters visible."),
            (("camera", "crop"), "Ensure the figures remain in frame."),
            (("style", "finish"), "Below is the final prompt."),
            (("style", "finish"), "visual note: Keep the characters visible."),
            (("style", "finish"), "visual note: Without occlusions."),
            (("style", "finish"), "visual note: Below is the final prompt."),
            (("camera", "crop"), "Please do not crop the figures."),
            (("style", "finish"), "Please preserve the image style."),
            (("lighting_color", "light_shadow"), "Should decrease exposure."),
            (("environment", "background"), "Needed to change the background."),
            (("lighting_color", "light_shadow"), "需提高曝光。"),
            (("style", "finish"), "需要保留人物。"),
            (("style", "render_language"), "保留风格。"),
            (("subjects", 0, "details"), ["务必补充细节。"]),
            (("style", "finish"), "visual note preserve the image style."),
        )
        for path, invalid_value in cases:
            with self.subTest(path=path, invalid_value=invalid_value):
                value = adult_pair_ir()
                target = value
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = invalid_value
                with self.assertRaises(ArtPromptContractError) as caught:
                    parse_art_prompt_contract(json.dumps(
                        value,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ))
                self.assertEqual(
                    caught.exception.code,
                    "art-prompt-contract-meta-instruction",
                )

        value = adult_pair_ir(applied_requirements=[])
        value["style"]["finish"] = (
            "Without harsh shadows, smooth skin highlights retain natural transitions."
        )
        parsed = parse_art_prompt_contract(json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
        ))
        self.assertIn("Without harsh shadows", parsed["style"]["finish"])

    def test_applied_requirement_must_be_copied_from_front_five_value(self):
        value = adult_pair_ir(applied_requirements=["成熟电影感已经落实"])
        with self.assertRaises(ArtPromptContractError) as caught:
            parse_art_prompt_contract(json.dumps(
                value,
                ensure_ascii=False,
                separators=(",", ":"),
            ))
        self.assertEqual(caught.exception.code, "art-prompt-contract-ledger-not-grounded")

    def test_bare_english_operation_echoes_are_rejected_at_clause_boundaries(self):
        commands = (
            "increase material detail",
            "add material detail",
            "improve material detail",
            "adjust material detail",
            "change material detail",
            "replace material detail",
            "remove material detail",
            "delete material detail",
            "optimize material detail",
            "enhance material detail",
            "make the character design more sensual",
            "use a mature adult-oriented atmosphere",
            "set the palette to warm gold",
        )
        for command in commands:
            for finish in (command, f"skin highlights are natural; {command}"):
                with self.subTest(finish=finish):
                    value = adult_pair_ir()
                    value["style"]["finish"] = finish
                    with self.assertRaises(ArtPromptContractError) as caught:
                        parse_art_prompt_contract(json.dumps(
                            value,
                            ensure_ascii=False,
                            separators=(",", ":"),
                        ))
                    self.assertEqual(
                        caught.exception.code,
                        "art-prompt-contract-meta-instruction",
                    )

    def test_english_final_state_facts_are_valid_ledger_entries(self):
        finish = (
            "high material detail with natural skin highlights and layered silk shading"
        )
        render_language = (
            "premium fantasy game painting, sensual mature character design"
        )
        atmosphere = (
            "mature adult-oriented atmosphere with warm intimate lighting"
        )
        value = adult_pair_ir(applied_requirements=[
            finish,
            render_language,
            atmosphere,
        ])
        value["style"]["finish"] = finish
        value["style"]["render_language"] = render_language
        value["style"]["atmosphere"] = atmosphere
        contract = parse_art_prompt_contract(json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
        ))
        self.assertEqual(len(contract["applied_requirements"]), 3)

    def test_repeating_one_value_across_required_slots_is_rejected(self):
        value = adult_pair_ir(applied_requirements=[])
        repeated = "统一细节描述"
        for key in value["style"]:
            value["style"][key] = repeated
        for subject in value["subjects"]:
            for key in ("name", "count", "pose", "action"):
                subject[key] = repeated
            for key in ("appearance", "materials", "colors", "details"):
                subject[key] = [repeated]
        value["relations"] = [repeated]
        for section in ("environment", "lighting_color", "camera"):
            for key, item in value[section].items():
                value[section][key] = [repeated] if isinstance(item, list) else repeated
        with self.assertRaises(ArtPromptContractError) as caught:
            parse_art_prompt_contract(json.dumps(
                value,
                ensure_ascii=False,
                separators=(",", ":"),
            ))
        self.assertEqual(caught.exception.code, "art-prompt-contract-duplicate-facts")

    def test_object_only_contract_rejects_person_body_or_portrait_cues(self):
        for field, text in (
            ("appearance", "女性身体曲线与清晰五官"),
            ("camera", "全身肖像构图"),
        ):
            with self.subTest(field=field):
                value = sensitive_object_ir()
                if field == "appearance":
                    value["subjects"][0]["appearance"].append(text)
                else:
                    value["camera"]["shot"] = text
                with self.assertRaises(ArtPromptContractError) as caught:
                    parse_art_prompt_contract(json.dumps(
                        value,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ))
                self.assertEqual(
                    caught.exception.code,
                    "art-prompt-contract-object-person-inconsistent",
                )

    def test_object_product_panorama_and_closeup_remain_valid(self):
        contract = parse_art_prompt_contract(json.dumps(
            sensitive_object_ir(),
            ensure_ascii=False,
            separators=(",", ":"),
        ))
        self.assertEqual(contract["camera"]["shot"], "产品全景")
        self.assertIn("物体特写", contract["camera"]["depth_of_field"])

    def test_typed_slots_reject_generic_or_wrong_domain_values(self):
        cases = (
            (("style", "medium"), "art"),
            (("style", "render_language"), "Chinese"),
            (("style", "atmosphere"), "tone"),
            (("style", "finish"), "high"),
            (("camera", "shot"), "view"),
            (("camera", "angle"), "view"),
            (("camera", "composition"), "layout"),
            (("camera", "perspective"), "亲密"),
            (("camera", "depth_of_field"), "柔和"),
        )
        for path, invalid_value in cases:
            with self.subTest(path=path, invalid_value=invalid_value):
                value = adult_pair_ir(applied_requirements=[])
                value[path[0]][path[1]] = invalid_value
                with self.assertRaises(ArtPromptContractError) as caught:
                    parse_art_prompt_contract(json.dumps(
                        value,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ))
                self.assertEqual(
                    caught.exception.code,
                    "art-prompt-contract-slot-semantic",
                )

    def test_typed_slots_allow_short_but_semantically_exact_values(self):
        value = adult_pair_ir(applied_requirements=[])
        value["style"] = {
            "medium": "水彩",
            "render_language": "厚涂",
            "atmosphere": "浪漫",
            "finish": "丝绸质感",
        }
        value["camera"].update({
            "shot": "特写",
            "angle": "俯视",
            "composition": "三角构图",
            "perspective": "标准透视",
            "depth_of_field": "浅景深",
        })
        parsed = parse_art_prompt_contract(json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
        ))
        self.assertEqual(parsed["style"]["medium"], "水彩")
        self.assertEqual(parsed["camera"]["depth_of_field"], "浅景深")

    def test_canonical_closure_text_does_not_supply_typed_slot_richness(self):
        for finish in (
            "画面质感细腻丰富",
            "high，画面质感细腻丰富",
            "high, image quality is refined with rich material detail",
        ):
            with self.subTest(finish=finish):
                value = adult_pair_ir(applied_requirements=[])
                value["style"]["finish"] = finish
                with self.assertRaises(ArtPromptContractError) as caught:
                    parse_art_prompt_contract(json.dumps(
                        value,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ))
                self.assertEqual(
                    caught.exception.code,
                    "art-prompt-contract-slot-semantic",
                )

        value = adult_pair_ir(applied_requirements=[])
        value["style"]["finish"] = "丝绸纹理与皮肤高光层次丰富，画面质感细腻丰富"
        parsed = parse_art_prompt_contract(json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
        ))
        self.assertIn("丝绸纹理", parsed["style"]["finish"])

    def test_structured_instruction_demands_correct_slots_and_dense_output(self):
        prompt = build_art_prompt_contract_instruction(
            "两位成年女性角色坐在室内",
            "增加画面质感",
        )
        self.assertEqual(STRUCTURED_OUTPUT_MAX_TOKENS, 2048)
        for marker in (
            "style.render_language",
            "camera.perspective",
            "约1000至1600个中文字",
            "不得为凑字数",
            "不能只在 terminal_constraints 重复",
            "普通可见事实也必须进入对应前五段",
        ):
            self.assertIn(marker, prompt)


class PromptAssistantStructuredArtTests(unittest.TestCase):
    BASE = "两位25岁以上的成年东方女性角色，亲密依偎在一起。"
    INSTRUCTION = "增加画面质感，人物造型性感，偏成人向"
    ENGLISH_INSTRUCTION = (
        "increase material detail, make the character design more sensual, "
        "use a mature adult-oriented atmosphere"
    )
    DETAILED_SOURCE = (
        "两位25岁以上的成年东方女性角色亲密依偎在一起。"
        "左侧人物身穿青绿色丝绸服饰，右侧人物身穿象牙白与淡金色薄纱服饰。"
        "柔和暖光照亮人物，淡金屏风与帷幔构成背景。"
        "要求：两张脸必须具有明显不同的五官特征；四只手结构正确且归属明确；身体交叠关系合理。"
        "避免：幼态儿童比例；复制脸；错误手指；融合肢体；塑料皮肤。"
    )

    @staticmethod
    def payload(*, requirements: str, prompt_schema: str | None = SCHEMA_VERSION) -> dict:
        value = {
            "surface": "art",
            "purpose": "optimize",
            "prompt": PromptAssistantStructuredArtTests.BASE,
            "currentPrompt": PromptAssistantStructuredArtTests.BASE,
            "requirements": requirements,
            "supportsNegativePrompt": False,
            "nsfw": True,
        }
        if prompt_schema is not None:
            value["promptSchema"] = prompt_schema
        return value

    def run_with_ir(
        self,
        ir: dict,
        *,
        requirements: str,
        payload_overrides: dict | None = None,
    ) -> tuple[dict, list[dict]]:
        assistant = SERVICE.PromptAssistant()
        calls: list[dict] = []

        def generate(prompt: str, **kwargs):
            calls.append({"prompt": prompt, **kwargs})
            return json.dumps(ir, ensure_ascii=False, separators=(",", ":"))

        assistant.generate = generate
        payload = self.payload(requirements=requirements)
        payload.update(payload_overrides or {})
        result = assistant.optimize_prompt(payload)
        return result, calls

    def simple_payload(self) -> dict:
        source = "一个比基尼女牵着一条狗走在海边，二次元风格"
        return {
            "surface": "art",
            "purpose": "optimize",
            "prompt": source,
            "currentPrompt": source,
            "promptSchema": SCHEMA_VERSION,
            "promptDetailMode": "simple-structured-v1",
            "requirements": (
                "提示词编辑模式：以 prompt / currentPrompt 中的完整原提示词为唯一底稿，只执行用户本次明确提出的修改。\n"
                "画面质量要求：结构准确、材质可信、光影层次清晰。"
            ),
            "supportsNegativePrompt": False,
            "nsfw": True,
        }

    def test_service_short_prompt_uses_bounded_detailed_sections_without_age_drift(self):
        assistant = SERVICE.PromptAssistant()
        calls = []

        def generate(prompt: str, **kwargs):
            calls.append({"prompt": prompt, **kwargs})
            self.fail("simple deterministic route must not call the local model")

        assistant.generate = generate
        result = assistant.optimize_prompt(self.simple_payload())
        self.assertEqual(calls, [])
        self.assertEqual(result["editContract"], "structured-recompile-v1")
        self.assertEqual(result["promptSchema"], SCHEMA_VERSION)
        self.assertEqual(
            tuple(
                line.strip()
                for line in result["positivePrompt"].splitlines()
                if line.strip().startswith("[") and line.strip().endswith("]")
            ),
            SECTIONS,
        )
        self.assertGreaterEqual(len(result["positivePrompt"].replace("\n", "")), 300)
        self.assertIn("一名身穿比基尼的成年女性", result["positivePrompt"])
        self.assertIn("一条狗", result["positivePrompt"])
        self.assertIn("牵着一条狗", result["positivePrompt"])
        self.assertIn("海边", result["positivePrompt"])
        self.assertIn("二次元", result["positivePrompt"])
        self.assertNotRegex(result["positivePrompt"], r"少女|女孩|未成年")

    def test_service_short_prompt_applies_real_quality_instruction_without_model(self):
        assistant = SERVICE.PromptAssistant()
        calls = []

        def generate(prompt: str, **kwargs):
            calls.append({"prompt": prompt, **kwargs})
            self.fail("simple deterministic quality closure must not call the local model")

        assistant.generate = generate
        payload = self.simple_payload()
        payload["requirements"] = "增强材质、光影层次和画面质感"
        result = assistant.optimize_prompt(payload)
        self.assertEqual(calls, [])
        self.assertEqual(result["editContract"], "structured-recompile-v1")
        self.assertEqual(result["promptSchema"], SCHEMA_VERSION)
        self.assertIn("材质与纹理细腻清晰", result["positivePrompt"])
        self.assertIn("光影层次丰富，高光与阴影过渡自然", result["positivePrompt"])
        self.assertIn("画面质感精致，细节清晰，完成度高", result["positivePrompt"])
        self.assertIn(
            '明暗关系 = "主体明暗层次清楚，高光与阴影过渡受控，'
            '光影层次丰富，高光与阴影过渡自然，光线自然受控"',
            result["positivePrompt"],
        )
        self.assertEqual(
            tuple(
                line.strip()
                for line in result["positivePrompt"].splitlines()
                if line.strip().startswith("[") and line.strip().endswith("]")
            ),
            SECTIONS,
        )

    def test_simple_quality_materializer_covers_every_allowlisted_domain_anchor(self):
        source = self.simple_payload()["currentPrompt"]
        payload = {"promptDetailMode": "simple-structured-v1"}
        anchor_domains = {
            "材质": "material",
            "纹理": "material",
            "光影": "lighting",
            "光线": "lighting",
            "高光": "lighting",
            "阴影": "lighting",
            "层次": "lighting",
            "画面质感": "quality",
            "画质": "quality",
            "细节": "quality",
            "清晰": "quality",
            "清晰度": "quality",
            "完成度": "quality",
        }
        for verb in ("增强", "提升", "提高", "强化", "改善", "优化"):
            for anchor, domain in anchor_domains.items():
                instruction = f"{verb}{anchor}"
                with self.subTest(instruction=instruction):
                    self.assertTrue(
                        SERVICE.ordinary_art_uses_simple_structured_contract(
                            payload,
                            source,
                            instruction,
                        )
                    )
                    contract = SERVICE.ordinary_art_build_simple_deterministic_contract(
                        source
                    )
                    ledger = (
                        SERVICE.ordinary_art_apply_simple_deterministic_quality_requirements(
                            source,
                            instruction,
                            contract,
                        )
                    )
                    self.assertEqual(len(ledger), 1)
                    self.assertIn(
                        SERVICE.ORDINARY_ART_SIMPLE_STRUCTURED_QUALITY_PHRASES[domain],
                        ledger[0],
                    )
                    self.assertEqual(
                        SERVICE.ordinary_art_structured_requirement_ledger_failure(
                            instruction,
                            ledger,
                            grounded_mapping=True,
                            source_prompt=source,
                        ),
                        "",
                    )
                    assistant = SERVICE.PromptAssistant()
                    calls = []

                    def generate(prompt: str, **kwargs):
                        calls.append({"prompt": prompt, **kwargs})
                        self.fail(
                            "every allowlisted simple quality edit must close without the model"
                        )

                    assistant.generate = generate
                    service_payload = self.simple_payload()
                    service_payload["requirements"] = instruction
                    result = assistant.optimize_prompt(service_payload)
                    self.assertEqual(calls, [])
                    self.assertIn(
                        SERVICE.ORDINARY_ART_SIMPLE_STRUCTURED_QUALITY_PHRASES[domain],
                        result["positivePrompt"],
                    )
                    self.assertEqual(
                        tuple(
                            line.strip()
                            for line in result["positivePrompt"].splitlines()
                            if line.strip().startswith("[")
                            and line.strip().endswith("]")
                        ),
                        SECTIONS,
                    )

        self.assertFalse(
            SERVICE.ordinary_art_uses_simple_structured_contract(
                payload,
                source,
                "增强材质；提高光影层次",
            )
        )

        for instruction in (
            "增强材质和提升光影",
            "增强材质并提升光影",
            "增强材质、提升光影",
            "提升材质与强化画质",
            "增强材质以及优化画质",
        ):
            with self.subTest(multi_operation=instruction):
                self.assertFalse(
                    SERVICE.ordinary_art_uses_simple_structured_contract(
                        payload,
                        source,
                        instruction,
                    )
                )
                assistant = SERVICE.PromptAssistant()

                def generate(prompt: str, **kwargs):
                    raise RuntimeError("full structured model fallback")

                assistant.generate = generate
                service_payload = self.simple_payload()
                service_payload["requirements"] = instruction
                with self.assertRaisesRegex(
                    RuntimeError,
                    "full structured model fallback",
                ):
                    assistant.optimize_prompt(service_payload)

    def test_service_short_prompt_bypasses_model_and_signs_deterministically(self):
        assistant = SERVICE.PromptAssistant()
        calls = []

        def generate(prompt: str, **kwargs):
            calls.append({"prompt": prompt, **kwargs})
            self.fail("simple deterministic route must not enter model repair")

        assistant.generate = generate
        result = assistant.optimize_prompt(self.simple_payload())
        self.assertEqual(calls, [])
        self.assertEqual(result["promptSchema"], SCHEMA_VERSION)
        self.assertIn("一名身穿比基尼的成年女性", result["positivePrompt"])
        self.assertIn("一名成年女性牵着一条狗", result["positivePrompt"])

    def test_service_short_prompt_builds_typed_lighting_slots_without_repair(self):
        assistant = SERVICE.PromptAssistant()
        calls = []

        def generate(prompt: str, **kwargs):
            calls.append({"prompt": prompt, **kwargs})
            self.fail("simple deterministic route must not enter model repair")

        assistant.generate = generate
        result = assistant.optimize_prompt(self.simple_payload())
        self.assertEqual(calls, [])
        self.assertEqual(result["promptSchema"], SCHEMA_VERSION)
        self.assertIn('光源方向 = "自然环境光从画面侧上方照射主体"', result["positivePrompt"])
        self.assertIn('光源软硬 = "柔和主光配合受控轮廓光，明暗转折自然"', result["positivePrompt"])

    def test_service_short_prompt_rejects_source_fact_drift_without_model_repair(self):
        drift_cases = []

        extra_cat = bikini_woman_and_dog_ir()
        extra_cat["subject_count"] = 3
        cat = json.loads(json.dumps(extra_cat["subjects"][1], ensure_ascii=False))
        cat.update({
            "name": "一只红色猫",
            "count": "一只",
            "appearance": ["红色猫咪身体比例自然"],
            "pose": "四足行走姿态",
            "action": "跟随人物与犬只同行",
            "materials": ["自然猫毛质感"],
            "colors": ["红色猫毛"],
            "details": ["猫咪轮廓清楚"],
        })
        extra_cat["subjects"].append(cat)
        extra_cat["relations"].append("红色猫跟随成年女性与犬只同行")
        drift_cases.append(("extra-cat", extra_cat))

        youngified = bikini_woman_and_dog_ir()
        youngified["subjects"][0]["name"] = "一名身穿比基尼的少女"
        drift_cases.append(("youngification", youngified))

        gender_drift = bikini_woman_and_dog_ir()
        gender_drift["subjects"][0]["name"] = "一名身穿比基尼的成年男性"
        drift_cases.append(("gender", gender_drift))

        color_drift = bikini_woman_and_dog_ir()
        color_drift["subjects"][0]["colors"] = ["红色比基尼", "人物固有色"]
        drift_cases.append(("color", color_drift))

        surfboard_drift = bikini_woman_and_dog_ir()
        surfboard_drift["environment"]["background"] = "海面、天空和冲浪板构成远景"
        drift_cases.append(("surfboard", surfboard_drift))

        weather_drift = bikini_woman_and_dog_ir()
        weather_drift["environment"]["background"] = "正午多云天空与海面构成远景"
        drift_cases.append(("time-weather", weather_drift))

        setting_drift = bikini_woman_and_dog_ir()
        setting_drift["environment"]["background"] = "海面远方出现巨大火山口"
        drift_cases.append(("setting", setting_drift))

        breed_drift = bikini_woman_and_dog_ir()
        breed_drift["subjects"][1]["name"] = "一条泰迪狗"
        drift_cases.append(("breed", breed_drift))

        hidden_male = bikini_woman_and_dog_ir()
        hidden_male["environment"]["background"] = "海面、天空和一名成年男性路人构成远景"
        drift_cases.append(("cross-slot-male", hidden_male))

        hidden_woman = bikini_woman_and_dog_ir()
        hidden_woman["relations"].append("另一名成年女性在旁边同行")
        drift_cases.append(("cross-slot-extra-woman", hidden_woman))

        for label, background in (
            ("seagull", "海面、天空和海鸥构成远景"),
            ("castle", "海面、天空和城堡构成远景"),
            ("palm-tree", "海面、天空和棕榈树构成远景"),
            ("parasol", "海面、天空和太阳伞构成远景"),
        ):
            drift = bikini_woman_and_dog_ir()
            drift["environment"]["background"] = background
            drift_cases.append((label, drift))

        pomeranian_drift = bikini_woman_and_dog_ir()
        pomeranian_drift["subjects"][1]["appearance"] = ["博美犬的品种特征清晰"]
        drift_cases.append(("pomeranian", pomeranian_drift))

        hidden_action_male = bikini_woman_and_dog_ir()
        hidden_action_male["subjects"][0]["action"] = "牵着狗并与一名成年男性路人握手"
        drift_cases.append(("subject-action-hidden-male", hidden_action_male))

        hidden_appearance_male = bikini_woman_and_dog_ir()
        hidden_appearance_male["subjects"][0]["appearance"].append("肩后站着一名成年男性路人")
        drift_cases.append(("subject-appearance-hidden-male", hidden_appearance_male))

        camera_hidden_male = bikini_woman_and_dog_ir()
        camera_hidden_male["camera"]["composition"] = "成年女性、狗与一名成年男性路人形成三主体构图"
        drift_cases.append(("camera-hidden-male", camera_hidden_male))

        camera_extra_woman = bikini_woman_and_dog_ir()
        camera_extra_woman["camera"]["composition"] = "成年女性、狗与另一名成年女性形成三主体构图"
        drift_cases.append(("camera-extra-woman", camera_extra_woman))

        located_women = bikini_woman_and_dog_ir()
        located_women["relations"] = ["前景成年女性牵着狗，远景成年女性面向镜头"]
        drift_cases.append(("located-extra-woman", located_women))

        located_dogs = bikini_woman_and_dog_ir()
        located_dogs["relations"] = ["成年女性分别牵着前景狗与远景狗"]
        drift_cases.append(("located-extra-dog", located_dogs))

        three_silhouettes = bikini_woman_and_dog_ir()
        three_silhouettes["relations"].append("画面形成三道独立身影")
        drift_cases.append(("aggregate-three-silhouettes", three_silhouettes))

        plural_action = bikini_woman_and_dog_ir()
        plural_action["subjects"][0]["action"] = "她们共同牵着一条狗沿海边行走"
        drift_cases.append(("subject-action-plural-women", plural_action))

        plural_relation = bikini_woman_and_dog_ir()
        plural_relation["relations"] = ["both women walk with the dog along the beach"]
        drift_cases.append(("relation-plural-women", plural_relation))

        plural_camera = bikini_woman_and_dog_ir()
        plural_camera["camera"]["composition"] = "成年女性们与狗形成稳定横向构图"
        drift_cases.append(("camera-plural-women", plural_camera))

        plural_dogs = bikini_woman_and_dog_ir()
        plural_dogs["subjects"][1]["action"] = "dogs walk beside the woman along the beach"
        drift_cases.append(("subject-action-plural-dogs", plural_dogs))

        tourist_crowd = bikini_woman_and_dog_ir()
        tourist_crowd["environment"]["background"] = "海面和天空形成简洁远景，一群游客在后景散步"
        drift_cases.append(("background-tourist-crowd", tourist_crowd))

        sister_relation = bikini_woman_and_dog_ir()
        sister_relation["relations"] = ["两姐妹牵着狗沿海边共同向前行走"]
        drift_cases.append(("relation-sisters", sister_relation))

        split_locator_women = bikini_woman_and_dog_ir()
        split_locator_women["subjects"][0]["action"] = "前景成年女性牵着狗沿海边行走"
        split_locator_women["environment"]["background"] = "海面和天空形成远景，远景成年女性面向镜头"
        drift_cases.append(("cross-scalar-located-women", split_locator_women))

        split_locator_dogs = bikini_woman_and_dog_ir()
        split_locator_dogs["subjects"][1]["action"] = "前景一条狗沿海边行走"
        split_locator_dogs["environment"]["background"] = "海面和天空形成远景，远景一条狗面向镜头"
        drift_cases.append(("cross-scalar-located-dogs", split_locator_dogs))

        generic_passerby = bikini_woman_and_dog_ir()
        generic_passerby["environment"]["background"] = "海面和天空形成远景，一名路人在远景散步"
        drift_cases.append(("generic-passerby", generic_passerby))

        generic_person = bikini_woman_and_dog_ir()
        generic_person["subjects"][0]["action"] = "牵着狗并与一名人物握手"
        drift_cases.append(("generic-person", generic_person))

        tagged_women = bikini_woman_and_dog_ir()
        tagged_women["relations"] = ["成年女性A牵着狗，成年女性B面向镜头"]
        drift_cases.append(("identity-tagged-women", tagged_women))

        tagged_women_zh = bikini_woman_and_dog_ir()
        tagged_women_zh["relations"] = ["成年女性甲牵着狗，成年女性乙面向镜头"]
        drift_cases.append(("identity-tagged-women-zh", tagged_women_zh))

        reversed_relation = bikini_woman_and_dog_ir()
        reversed_relation["subjects"][0]["action"] = "被犬只牵引沿海边行走"
        reversed_relation["subjects"][1]["action"] = "牵着成年女性沿海边行走"
        reversed_relation["relations"] = ["一条狗牵着一名成年女性沿海边行走"]
        drift_cases.append(("core-relation-reversed", reversed_relation))

        removed_relation = bikini_woman_and_dog_ir()
        removed_relation["subjects"][0]["action"] = "独自沿岸行走，不牵引犬只"
        removed_relation["subjects"][1]["action"] = "脱离成年女性独自奔跑"
        removed_relation["relations"] = ["彼此无牵引关系"]
        drift_cases.append(("core-relation-removed", removed_relation))

        replaced_style = bikini_woman_and_dog_ir()
        replaced_style["style"]["medium"] = "写实摄影"
        replaced_style["style"]["render_language"] = "照片级超写实摄影语言"
        drift_cases.append(("core-style-replaced", replaced_style))

        replaced_clothing = bikini_woman_and_dog_ir()
        replaced_clothing["subjects"][0]["name"] = "一名身穿连衣裙的成年女性"
        replaced_clothing["subjects"][0]["appearance"] = ["连衣裙装束", "成年女性外观"]
        replaced_clothing["subjects"][0]["materials"] = ["连衣裙布料"]
        drift_cases.append(("core-clothing-replaced", replaced_clothing))

        replaced_setting = bikini_woman_and_dog_ir()
        replaced_setting["environment"]["setting"] = "开阔湖边与湖岸环境"
        replaced_setting["environment"]["background"] = "湖面形成简洁远景"
        replaced_setting["environment"]["support_surface"] = "湖岸稳定承托主体行走"
        drift_cases.append(("core-setting-replaced", replaced_setting))

        camera_negates_relation = bikini_woman_and_dog_ir()
        camera_negates_relation["camera"]["composition"] = "成年女性与犬只彼此无牵引关系，形成分离式双主体构图"
        drift_cases.append(("camera-negates-core-relation", camera_negates_relation))

        action_replaces_clothing = bikini_woman_and_dog_ir()
        action_replaces_clothing["subjects"][0]["action"] = "身穿连衣裙的成年女性牵着犬只沿海边同行"
        drift_cases.append(("action-replaces-core-clothing", action_replaces_clothing))

        pose_replaces_clothing = bikini_woman_and_dog_ir()
        pose_replaces_clothing["subjects"][0]["pose"] = "身穿连衣裙的成年女性自然行走，重心稳定"
        drift_cases.append(("pose-replaces-core-clothing", pose_replaces_clothing))

        details_replace_style = bikini_woman_and_dog_ir()
        details_replace_style["subjects"][0]["details"].append("人物整体以写实摄影风格呈现")
        drift_cases.append(("details-replace-core-style", details_replace_style))

        camera_replaces_style = bikini_woman_and_dog_ir()
        camera_replaces_style["camera"]["perspective"] = "照片级写实摄影风格的真实镜头透视"
        drift_cases.append(("camera-replaces-core-style", camera_replaces_style))

        for label, ir in drift_cases:
            with self.subTest(label=label):
                self.assertTrue(
                    SERVICE.ordinary_art_simple_contract_source_failure(
                        self.simple_payload()["currentPrompt"],
                        ir,
                    ),
                    msg=label,
                )

    def test_service_short_prompt_replaces_model_terminal_facts_deterministically(self):
        malicious_constraints = (
            "主体数量限定为一名成年女性、一条狗和一只红色猫，地点限定为海边",
            "背景只允许海边与一座金色宫殿，主体保持成年女性与狗",
            "时间限定为黄昏，天气限定为暴雨，主体保持成年女性与狗",
            "成年女性与狗保持同行，狗的品种限定为柯基犬",
        )
        for malicious in malicious_constraints:
            with self.subTest(malicious=malicious):
                assistant = SERVICE.PromptAssistant()
                calls = []

                def generate(prompt: str, **kwargs):
                    calls.append({"prompt": prompt, **kwargs})
                    self.fail("simple deterministic route must not read model terminal facts")

                assistant.generate = generate
                result = assistant.optimize_prompt(self.simple_payload())
                terminal = result["positivePrompt"].split("[用户附加要求]", 1)[1]
                self.assertEqual(calls, [])
                self.assertNotIn(malicious, terminal)
                for leaked in ("红色猫", "金色宫殿", "黄昏", "暴雨", "柯基犬"):
                    self.assertNotIn(leaked, terminal)
                self.assertIn("核心主体数量、身份、动作关系、地点与风格均与原始底稿一致", terminal)
                self.assertIn("允许补充不与底稿冲突的材质、光影、镜头与背景表现细节", terminal)
                self.assertIn("可直接生图的高完成度", terminal)

    def test_service_simple_route_abstains_on_prop_wordplay_and_content_edits(self):
        manifest_cases = {
            "一个猫耳女性站在海边，二次元风格": [],
            "一个猫女站在海边，二次元风格": [],
            "一个女孩吃着热狗走在海边，二次元风格": ["female"],
            "一个女孩站在花海，二次元风格": ["female"],
            "一个女武士手持战斧站在山谷，二次元风格": [],
            "三个女人牵着一条狗走在海边": ["female", "female", "female", "dog"],
            "一个女人牵着两条狗走在海边": ["female", "dog", "dog"],
            "两个女人和一个女人走在海边": ["female", "female", "female"],
            "一个女骑士站在山谷": ["female"],
            "一个机器人女孩站在城市": [],
            "一辆跑车，少女漫画风格": [],
            "a car, girl manga style": [],
            "一件武士风格盔甲": [],
            "一个龙女站在山谷": [],
            "一个狐耳女孩走在海边，二次元风格": [],
            "一个狼耳女孩走在海边，二次元风格": [],
            "一个鹿角女站在山谷，二次元风格": [],
            "a fox-eared girl walks on the beach, anime style": [],
            "一辆跑车，女性向游戏风格": [],
            "一辆跑车，人物插画风格": [],
            "猫咪图案的背包放在桌面": [],
            "小狗风格玩偶放在桌面": [],
            "一个女人拿剑站在海边": [],
            "一个女人拿花束站在海边": [],
        }
        for source, expected in manifest_cases.items():
            with self.subTest(source=source):
                self.assertEqual(
                    SERVICE.ordinary_art_simple_source_subject_manifest(source),
                    expected,
                )

        two_women_ir = bikini_woman_and_dog_ir()
        two_women_ir["subjects"][0]["name"] = "两名身穿比基尼的成年女性"
        two_women_ir["subjects"][0]["count"] = "两名"
        two_women_ir["relations"] = ["两名成年女性共同牵着一条狗沿海边向前行走"]
        self.assertEqual(
            SERVICE.ordinary_art_simple_contract_source_failure(
                "两个比基尼女牵着一条狗走在海边，二次元风格",
                two_women_ir,
            ),
            "",
        )

        payload = {"promptDetailMode": "simple-structured-v1"}
        source = "一个比基尼女牵着一条狗走在海边，二次元风格"
        self.assertTrue(SERVICE.ordinary_art_uses_simple_structured_contract(
            payload,
            source,
            "增强材质、光影层次和画面质感",
        ))
        preserved_sources = {
            "一个穿红色比基尼的女人牵着一条狗走在黄昏海边，二次元风格": (
                "红色比基尼",
                "黄昏",
            ),
            "一个穿红比基尼的女人牵着一条狗走在黄昏海边，二次元风格": (
                "红色比基尼",
                "黄昏",
            ),
            "一个穿蓝色连衣裙的女人站在雨天海边，二次元风格": (
                "蓝色连衣裙",
                "雨天",
            ),
        }
        for preserved_source, markers in preserved_sources.items():
            with self.subTest(preserved_source=preserved_source):
                self.assertTrue(
                    SERVICE.ordinary_art_uses_simple_structured_contract(
                        payload,
                        preserved_source,
                        "",
                    )
                )
                compiled = compile_art_prompt_contract(
                    SERVICE.ordinary_art_build_simple_deterministic_contract(
                        preserved_source
                    )
                )
                for marker in markers:
                    self.assertIn(marker, compiled)
        for instruction in ("把背景改成城市", "增加一只红猫"):
            with self.subTest(instruction=instruction):
                self.assertFalse(
                    SERVICE.ordinary_art_uses_simple_structured_contract(
                        payload,
                        source,
                        instruction,
                    )
                )
        self.assertFalse(SERVICE.ordinary_art_uses_simple_structured_contract(
            payload,
            "两个成年人出现在海边，二次元风格",
            "增强材质与光影",
        ))
        for unsafe_or_ambiguous_source in (
            "一个穿旗袍的女人牵着一条狗走在海边，二次元风格",
            "一个比基尼女牵着一条狗走在海边，蓝天，二次元风格",
            "一个女人牵着一条狗站在海边，二次元风格",
            "两个女人牵着一条狗走在海边，二次元风格",
            "一个全裸女站在海边，二次元风格",
            "一个比基尼女牵着一条狗走在海边，二次元风格，使用@参考图1",
            "一群女人站在海边，二次元风格",
            "two women standing on a beach, anime style",
            "双胞胎女人站在海边，二次元风格",
            "一个女人牵着狗们走在海边，二次元风格",
            "一个比基尼女坐在海边牵着一条正在行走的狗，二次元风格",
            "一个比基尼女站在海边牵着一条正在行走的狗，二次元风格",
            "一个女人牵着一条穿西装的狗走在海边，二次元风格",
            "女人俩站在海边，二次元风格",
            "女人二人站在海边，二次元风格",
            "一个穿红比基尼的女人牵着一条狗走在黄昏雨中的海边，二次元风格",
            "一个比基尼女挥手牵着一条狗走在海边，二次元风格",
            "一个女人看着他牵着一条狗走在海边，二次元风格",
            "a woman watches him walk a dog on a beach, anime style",
            "一个比基尼女牵着一条狗正在海边行走，二次元风格",
            "一只猫站在海边，二次元风格",
            "一个女人先站在海边再坐着，二次元风格",
            "a woman with a dog walks a dog on a beach, anime style",
        ):
            with self.subTest(unsafe_or_ambiguous_source=unsafe_or_ambiguous_source):
                self.assertFalse(
                    SERVICE.ordinary_art_uses_simple_structured_contract(
                        payload,
                        unsafe_or_ambiguous_source,
                        "",
                    )
                )

    def test_service_short_prompt_never_enters_model_repair_path(self):
        assistant = SERVICE.PromptAssistant()
        calls = []

        def generate(prompt: str, **kwargs):
            calls.append({"prompt": prompt, **kwargs})
            self.fail("simple deterministic route must not call model repair")

        assistant.generate = generate
        result = assistant.optimize_prompt(self.simple_payload())
        self.assertEqual(calls, [])
        self.assertEqual(result["promptSchema"], SCHEMA_VERSION)
        self.assertIn("[用户附加要求]", result["positivePrompt"])

    def test_exact_acceptance_edit_is_applied_in_front_five_not_terminal_echo(self):
        requirements = f"用户本次修改要求（最高优先级）：{self.INSTRUCTION}"
        result, calls = self.run_with_ir(adult_pair_ir(), requirements=requirements)

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["max_length"], 2048)
        self.assertEqual(SERVICE.ORDINARY_ART_PROMPT_PATCH_MAX_LENGTH, 320)
        self.assertEqual(calls[0]["trace_label"], "ordinaryArtStructuredRecompile")
        self.assertIn(self.BASE, calls[0]["prompt"])
        self.assertIn(self.INSTRUCTION, calls[0]["prompt"])
        self.assertEqual(result["editContract"], "structured-recompile-v1")
        self.assertEqual(result["promptSchema"], SCHEMA_VERSION)

        compiled = result["positivePrompt"]
        front = front_five_sections(compiled)
        terminal = compiled.split("[用户附加要求]", 1)[1]
        self.assertEqual(compiled.count("["), 6)
        for marker in (
            "画面质感细腻丰富",
            "人物造型性感",
            "性感而匀称的成年女性造型",
            "偏成人向",
            "两位25岁以上的成年东方女性角色亲密依偎在一起",
        ):
            self.assertIn(marker, front)
        self.assertNotIn("增加画面质感", terminal)
        self.assertNotIn("人物造型性感", terminal)
        self.assertNotIn("偏成人向", terminal)
        for marker in ("两位", "25岁以上", "成年", "东方女性", "依偎"):
            self.assertIn(marker, front)

    def test_real_sparse_wrong_slot_response_is_rejected_before_closure(self):
        with self.assertRaises(
            SERVICE.OrdinaryArtPromptEditNotAppliedError
        ) as caught:
            self.run_with_ir(
                sparse_wrong_slot_pair_ir(),
                requirements=f"用户本次修改要求（最高优先级）：{self.INSTRUCTION}",
                payload_overrides={
                    "prompt": self.DETAILED_SOURCE,
                    "currentPrompt": self.DETAILED_SOURCE,
                },
            )
        self.assertIn(
            "art-prompt-contract-slot-semantic",
            caught.exception.diagnostics["applicationReason"],
        )

    def test_service_canonical_text_cannot_lift_a_generic_finish(self):
        ir = adult_pair_ir(applied_requirements=[
            "high，画面质感细腻丰富",
        ])
        ir["style"]["finish"] = "high，画面质感细腻丰富"
        with self.assertRaises(
            SERVICE.OrdinaryArtPromptEditNotAppliedError
        ) as caught:
            self.run_with_ir(
                ir,
                requirements="用户本次修改要求（最高优先级）：增加画面质感",
            )
        self.assertIn(
            "art-prompt-contract-slot-semantic",
            caught.exception.diagnostics["applicationReason"],
        )

    def test_rich_neutral_ir_restores_typed_source_facts_in_front_slots(self):
        ir = implicit_aesthetic_closure_ir_without_adult_identity(
            applied_requirements=[]
        )
        ir["subjects"][0]["name"] += "，左侧角色"
        ir["subjects"][1]["name"] += "，右侧角色"
        result, calls = self.run_with_ir(
            ir,
            requirements=f"用户本次修改要求（最高优先级）：{self.INSTRUCTION}",
            payload_overrides={
                "prompt": self.DETAILED_SOURCE,
                "currentPrompt": self.DETAILED_SOURCE,
            },
        )
        self.assertEqual(len(calls), 1)
        front = front_five_sections(result["positivePrompt"])
        terminal = result["positivePrompt"].split("[用户附加要求]", 1)[1]
        self.assertEqual(
            front.count("25岁以上的成年东方女性角色，东方女性角色"),
            2,
        )
        for fact in (
            "两张脸必须具有明显不同的五官特征",
            "四只手结构正确且归属明确",
        ):
            self.assertIn(fact, front)
            self.assertIn(fact, terminal)
        for constraint in (
            "身体交叠关系合理",
            "幼态儿童比例",
            "复制脸",
            "错误手指",
            "融合肢体",
            "塑料皮肤",
        ):
            self.assertIn(constraint, terminal)

    def test_service_ignores_model_operation_echo_and_rebuilds_grounded_ledger(self):
        operation_echoes = [
            "请增加画面质感",
            "请将人物造型改得更性感",
            "请使用偏成人向氛围",
        ]
        ir = adult_pair_ir(applied_requirements=operation_echoes)
        result, calls = self.run_with_ir(
            ir,
            requirements=f"用户本次修改要求（最高优先级）：{self.INSTRUCTION}",
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(result["editContract"], "structured-recompile-v1")
        for operation_echo in operation_echoes:
            self.assertNotIn(operation_echo, result["positivePrompt"])
        front = front_five_sections(result["positivePrompt"])
        for final_state in ("画面质感细腻丰富", "人物造型性感", "偏成人向"):
            self.assertIn(final_state, front)

    def test_rebuilt_ledger_rejects_operation_echo_when_front_facts_are_not_new(self):
        operation_echoes = [
            "请增加画面质感",
            "请将人物造型改得更性感",
            "请使用偏成人向氛围",
        ]
        ir = adult_pair_ir(applied_requirements=operation_echoes)
        source = self.BASE + "。" + "。".join((
            ir["style"]["finish"],
            ir["style"]["render_language"],
            ir["style"]["atmosphere"],
        ))
        with self.assertRaises(
            SERVICE.OrdinaryArtPromptEditNotAppliedError
        ) as caught:
            self.run_with_ir(
                ir,
                requirements=f"用户本次修改要求（最高优先级）：{self.INSTRUCTION}",
                payload_overrides={"prompt": source, "currentPrompt": source},
            )
        self.assertTrue(
            caught.exception.diagnostics["applicationReason"].startswith(
                "structured-ledger-no-new-fact:"
            )
        )

    def test_canonical_closure_materializes_three_implicit_aesthetic_edits(self):
        requirements = f"用户本次修改要求（最高优先级）：{self.INSTRUCTION}"
        direct_ir = implicit_aesthetic_closure_ir(applied_requirements=[])
        before = json.loads(json.dumps(direct_ir, ensure_ascii=False))
        ledger = SERVICE.ordinary_art_structured_apply_canonical_closure(
            requirements,
            direct_ir,
            self.BASE,
        )
        expected = (
            ("finish", "画面质感细腻丰富"),
            ("render_language", "人物造型性感且成年比例明确"),
            ("atmosphere", "偏成人向的成熟审美氛围"),
        )
        self.assertEqual(
            ledger,
            [direct_ir["style"][slot] for slot, _canonical in expected],
        )
        for slot, canonical in expected:
            self.assertEqual(
                direct_ir["style"][slot],
                f"{before['style'][slot]}，{canonical}",
            )
        direct_ir_without_closure_fields = json.loads(json.dumps(direct_ir, ensure_ascii=False))
        for slot, _canonical in expected:
            direct_ir_without_closure_fields["style"][slot] = before["style"][slot]
        self.assertEqual(direct_ir_without_closure_fields, before)

        result, calls = self.run_with_ir(
            implicit_aesthetic_closure_ir(applied_requirements=[]),
            requirements=requirements,
        )
        self.assertEqual(len(calls), 1)
        front = front_five_sections(result["positivePrompt"])
        for _slot, canonical in expected:
            self.assertIn(canonical, front)
        self.assertNotIn("请增加画面质感", result["positivePrompt"])

    def test_source_adult_group_is_restored_per_subject_before_compile(self):
        requirements = f"用户本次修改要求（最高优先级）：{self.INSTRUCTION}"
        direct_ir = implicit_aesthetic_closure_ir_without_adult_identity(
            applied_requirements=[]
        )
        ledger_before = list(direct_ir["applied_requirements"])
        self.assertTrue(
            SERVICE.ordinary_art_structured_restore_source_adult_identity(
                self.BASE,
                requirements,
                direct_ir,
            )
        )
        self.assertEqual(direct_ir["applied_requirements"], ledger_before)
        for subject in direct_ir["subjects"]:
            self.assertTrue(
                subject["name"].startswith("25岁以上的成年东方女性角色，")
            )
            self.assertTrue(
                SERVICE.ordinary_art_structured_has_explicit_adult_identity(
                    subject["name"]
                )
            )

        result, calls = self.run_with_ir(
            implicit_aesthetic_closure_ir_without_adult_identity(
                applied_requirements=[]
            ),
            requirements=requirements,
        )
        self.assertEqual(len(calls), 1)
        front = front_five_sections(result["positivePrompt"])
        self.assertEqual(front.count("25岁以上的成年东方女性角色，东方女性角色"), 2)
        for canonical in (
            "画面质感细腻丰富",
            "人物造型性感且成年比例明确",
            "偏成人向的成熟审美氛围",
        ):
            self.assertIn(canonical, front)

        english_source = "Two adult women are cuddling together."
        english_ir = implicit_aesthetic_closure_ir_without_adult_identity(
            applied_requirements=[]
        )
        english_ir["subjects"][0]["name"] = "eastern woman A"
        english_ir["subjects"][1]["name"] = "eastern woman B"
        self.assertTrue(
            SERVICE.ordinary_art_structured_restore_source_adult_identity(
                english_source,
                requirements,
                english_ir,
            )
        )
        for subject in english_ir["subjects"]:
            self.assertTrue(subject["name"].startswith("adult female, "))
        service_english_ir = (
            implicit_aesthetic_closure_ir_without_adult_identity(
                applied_requirements=[]
            )
        )
        service_english_ir["subjects"][0]["name"] = "eastern woman A"
        service_english_ir["subjects"][1]["name"] = "eastern woman B"
        english_result, _calls = self.run_with_ir(
            service_english_ir,
            requirements=requirements,
            payload_overrides={
                "prompt": english_source,
                "currentPrompt": english_source,
            },
        )
        self.assertEqual(
            front_five_sections(english_result["positivePrompt"]).count(
                "adult female, eastern woman"
            ),
            2,
        )

    def test_identity_mentions_do_not_disable_full_tuple_preservation(self):
        harmless_requirements = (
            "提高东方女性服饰的丝绸质感",
            "增加质感并保持东方女性身份",
        )
        for instruction in harmless_requirements:
            with self.subTest(instruction=instruction):
                contract = implicit_aesthetic_closure_ir_without_adult_identity(
                    applied_requirements=[]
                )
                self.assertTrue(
                    SERVICE.ordinary_art_structured_restore_source_adult_identity(
                        self.BASE,
                        f"用户本次修改要求（最高优先级）：{instruction}",
                        contract,
                    )
                )
                for subject in contract["subjects"]:
                    self.assertTrue(subject["name"].startswith(
                        "25岁以上的成年东方女性角色，"
                    ))

        changed = implicit_aesthetic_closure_ir_without_adult_identity(
            applied_requirements=[]
        )
        self.assertFalse(
            SERVICE.ordinary_art_structured_restore_source_adult_identity(
                self.BASE,
                "用户本次修改要求（最高优先级）：把人物性别改为男性",
                changed,
            )
        )

    def test_source_typed_manifest_preserves_faces_and_owned_bodyparts(self):
        contract = implicit_aesthetic_closure_ir_without_adult_identity(
            applied_requirements=[]
        )
        manifest, failure = (
            SERVICE.ordinary_art_structured_source_typed_preservation_manifest(
                self.DETAILED_SOURCE,
                "",
                contract,
            )
        )
        self.assertEqual(failure, "")
        self.assertEqual(
            {item["kind"] for item in manifest},
            {"distinct_faces", "bodypart_ownership", "visible_relation"},
        )
        self.assertTrue(all(item["slot"] == "relations" for item in manifest))
        self.assertEqual(
            SERVICE.ordinary_art_structured_apply_source_typed_preservation(
                self.DETAILED_SOURCE,
                "",
                contract,
            ),
            "",
        )
        relations = "\n".join(contract["relations"])
        self.assertIn("两张脸必须具有明显不同的五官特征", relations)
        self.assertIn("四只手结构正确且归属明确", relations)
        self.assertIn("身体交叠关系合理", relations)
        self.assertNotIn("双腿", relations)

    def test_english_source_atomic_sentences_preserve_faces_and_hands(self):
        source = (
            "Two adult women sit together. Their two faces are clearly distinct. "
            "All four hands have clear ownership."
        )
        clauses = SERVICE.ordinary_art_structured_source_atomic_clauses(source)
        self.assertEqual(len(clauses), 3)
        contract = implicit_aesthetic_closure_ir_without_adult_identity(
            applied_requirements=[]
        )
        manifest, failure = (
            SERVICE.ordinary_art_structured_source_typed_preservation_manifest(
                source,
                "",
                contract,
            )
        )
        self.assertEqual(failure, "")
        self.assertEqual(
            {item["kind"] for item in manifest},
            {"distinct_faces", "bodypart_ownership"},
        )

    def test_flattened_named_blocks_are_split_into_atomic_constraints(self):
        source = (
            "目标：高完成度商业插画；要求：两张脸明显不同；四只手归属明确；"
            "避免：复制脸；错误手指；塑料皮肤。"
        )
        blocks = SERVICE.ordinary_art_structured_hard_constraint_blocks(source)
        facts = "\n".join(fact for _label, fact in blocks)
        for marker in (
            "高完成度商业插画",
            "两张脸明显不同",
            "四只手归属明确",
            "复制脸",
            "错误手指",
            "塑料皮肤",
        ):
            self.assertIn(marker, facts)

    def test_counted_body_rewrite_targets_only_same_bodypart_contract(self):
        cases = (
            (
                "四只手结构正确且归属明确",
                "用户本次修改要求（最高优先级）：将四只手改为两只手",
            ),
            (
                "four hands have clear ownership",
                "change four hands to two hands",
            ),
            (
                "两张脸必须明显不同",
                "将两张脸改为一张脸",
            ),
        )
        for fact, instruction in cases:
            with self.subTest(fact=fact):
                self.assertTrue(
                    SERVICE.ordinary_art_structured_inline_hard_constraint_targeted(
                        fact,
                        instruction,
                    )
                )
        self.assertFalse(
            SERVICE.ordinary_art_structured_inline_hard_constraint_targeted(
                "四只手结构正确且归属明确",
                "增加四只手的高光细节",
            )
        )
        self.assertTrue(
            SERVICE.ordinary_art_structured_hard_block_targeted(
                "要求：四只手结构正确且归属明确。",
                "删除四只手要求",
                "要求",
                "四只手结构正确且归属明确",
            )
        )

    def test_source_adult_identity_restore_rejects_ambiguous_contexts(self):
        cases = (
            (
                "count-mismatch",
                "三位25岁以上的成年东方女性角色站在一起。",
                self.INSTRUCTION,
                implicit_aesthetic_closure_ir_without_adult_identity(
                    applied_requirements=[]
                ),
            ),
            (
                "mixed-minor",
                "一位25岁成年女性与一名17岁女孩站在一起。",
                self.INSTRUCTION,
                implicit_aesthetic_closure_ir_without_adult_identity(
                    applied_requirements=[]
                ),
            ),
            (
                "negated-adult-group",
                "Two adult women are not present.",
                self.INSTRUCTION,
                implicit_aesthetic_closure_ir_without_adult_identity(
                    applied_requirements=[]
                ),
            ),
            (
                "object-contract",
                "两个25年以上的成年葡萄酒瓶陈列在展台上。",
                "增加画面质感",
                sensitive_object_ir(),
            ),
            (
                "age-change",
                self.BASE,
                "把人物年龄改成20岁",
                implicit_aesthetic_closure_ir_without_adult_identity(
                    applied_requirements=[]
                ),
            ),
        )
        for label, source, instruction, contract in cases:
            with self.subTest(label=label):
                requirements = (
                    "用户本次修改要求（最高优先级）："
                    f"{instruction}"
                )
                before = json.loads(json.dumps(contract, ensure_ascii=False))
                self.assertFalse(
                    SERVICE.ordinary_art_structured_restore_source_adult_identity(
                        source,
                        requirements,
                        contract,
                    )
                )
                self.assertEqual(contract, before)
                if label in {
                    "count-mismatch",
                    "mixed-minor",
                    "negated-adult-group",
                    "age-change",
                }:
                    with self.assertRaises(
                        SERVICE.OrdinaryArtPromptEditNotAppliedError
                    ):
                        self.run_with_ir(
                            json.loads(json.dumps(before, ensure_ascii=False)),
                            requirements=requirements,
                            payload_overrides={
                                "prompt": source,
                                "currentPrompt": source,
                            },
                        )

    def test_english_canonical_closure_handles_empty_and_operation_ledgers(self):
        requirements = (
            "用户本次修改要求（最高优先级）："
            f"{self.ENGLISH_INSTRUCTION}"
        )
        expected = (
            ("finish", "image quality is refined with rich material detail"),
            (
                "render_language",
                "character design is sensual with clearly adult proportions",
            ),
            ("atmosphere", "mature adult-oriented aesthetic atmosphere"),
        )
        direct_ir = implicit_aesthetic_closure_ir(applied_requirements=[])
        original_style = dict(direct_ir["style"])
        ledger = SERVICE.ordinary_art_structured_apply_canonical_closure(
            requirements,
            direct_ir,
            self.BASE,
        )
        self.assertEqual(
            ledger,
            [direct_ir["style"][slot] for slot, _canonical in expected],
        )
        for slot, canonical in expected:
            self.assertEqual(
                direct_ir["style"][slot],
                f"{original_style[slot]}，{canonical}",
            )

        operation_echoes = [
            "increase material detail",
            "make the character design more sensual",
            "use a mature adult-oriented atmosphere",
        ]
        for label, applied_requirements in (
            ("empty", []),
            ("operation-echo", operation_echoes),
        ):
            with self.subTest(label=label):
                result, calls = self.run_with_ir(
                    implicit_aesthetic_closure_ir(
                        applied_requirements=applied_requirements
                    ),
                    requirements=requirements,
                )
                self.assertEqual(len(calls), 1)
                front = front_five_sections(result["positivePrompt"])
                for _slot, canonical in expected:
                    self.assertIn(canonical, front)
                for operation_echo in operation_echoes:
                    self.assertNotIn(operation_echo, result["positivePrompt"])

    def test_bilingual_canonical_closure_rejects_source_no_op(self):
        cases = (
            (
                self.ENGLISH_INSTRUCTION,
                "image quality is refined with rich material detail",
            ),
            (self.ENGLISH_INSTRUCTION, "画面质感细腻丰富"),
            (
                self.INSTRUCTION,
                "image quality is refined with rich material detail",
            ),
        )
        for instruction, existing_canonical in cases:
            with self.subTest(
                instruction=instruction,
                existing_canonical=existing_canonical,
            ):
                requirements = (
                    "用户本次修改要求（最高优先级）："
                    f"{instruction}"
                )
                source = f"{self.BASE} {existing_canonical}."
                direct_ir = implicit_aesthetic_closure_ir(applied_requirements=[])
                before = json.loads(json.dumps(direct_ir, ensure_ascii=False))
                self.assertEqual(
                    SERVICE.ordinary_art_structured_apply_canonical_closure(
                        requirements,
                        direct_ir,
                        source,
                    ),
                    [],
                )
                self.assertEqual(direct_ir, before)
                with self.assertRaises(
                    SERVICE.OrdinaryArtPromptEditNotAppliedError
                ) as caught:
                    self.run_with_ir(
                        implicit_aesthetic_closure_ir(applied_requirements=[]),
                        requirements=requirements,
                        payload_overrides={
                            "prompt": source,
                            "currentPrompt": source,
                        },
                    )
                self.assertIn(
                    "structured-ledger-",
                    caught.exception.diagnostics["applicationReason"],
                )

    def test_canonical_closure_fails_closed_for_unsafe_or_ambiguous_requests(self):
        cases = (
            "增加画面质感，改成三个人",
            "人物造型不性感",
            "不偏成人向",
            "减少画面质感",
            "删除人物造型",
            "改成20岁女性",
            "让两个人物亲吻",
            "改到森林场景",
            "改为红色光线",
            "使用低角度镜头",
            "增加裸体描写",
            "增加画面质感，提高画面质感",
        )
        service_rejections = {
            "增加画面质感，改成三个人",
            "人物造型不性感",
            "不偏成人向",
            "增加裸体描写",
            "增加画面质感，提高画面质感",
        }
        for instruction in cases:
            with self.subTest(instruction=instruction):
                requirements = f"用户本次修改要求（最高优先级）：{instruction}"
                direct_ir = implicit_aesthetic_closure_ir(applied_requirements=[])
                before = json.loads(json.dumps(direct_ir, ensure_ascii=False))
                self.assertEqual(
                    SERVICE.ordinary_art_structured_apply_canonical_closure(
                        requirements,
                        direct_ir,
                        self.BASE,
                    ),
                    [],
                )
                self.assertEqual(direct_ir, before)
                if instruction in service_rejections:
                    with self.assertRaises(
                        SERVICE.OrdinaryArtPromptEditNotAppliedError
                    ):
                        self.run_with_ir(
                            implicit_aesthetic_closure_ir(applied_requirements=[]),
                            requirements=requirements,
                        )

    def test_canonical_closure_object_allows_finish_but_not_person_sensual(self):
        finish_requirements = "用户本次修改要求（最高优先级）：增加画面质感"
        object_ir = sensitive_object_ir()
        object_ir["applied_requirements"] = []
        object_ir["style"]["finish"] = "玻璃高光与金属阴影自然过渡"
        original_finish = object_ir["style"]["finish"]
        ledger = SERVICE.ordinary_art_structured_apply_canonical_closure(
            finish_requirements,
            object_ir,
            "一个红色香水瓶陈列在展台上。",
        )
        self.assertEqual(ledger, [object_ir["style"]["finish"]])
        self.assertEqual(
            object_ir["style"]["finish"],
            f"{original_finish}，画面质感细腻丰富",
        )
        service_object_ir = sensitive_object_ir()
        service_object_ir["applied_requirements"] = []
        service_object_ir["style"]["finish"] = "玻璃高光与金属阴影自然过渡"
        result, _calls = self.run_with_ir(
            service_object_ir,
            requirements=finish_requirements,
            payload_overrides={
                "prompt": "一个红色香水瓶陈列在展台上。",
                "currentPrompt": "一个红色香水瓶陈列在展台上。",
            },
        )
        self.assertIn("画面质感细腻丰富", front_five_sections(result["positivePrompt"]))

        sensual_requirements = "用户本次修改要求（最高优先级）：人物造型性感"
        rejected = sensitive_object_ir()
        rejected["applied_requirements"] = []
        before = json.loads(json.dumps(rejected, ensure_ascii=False))
        self.assertEqual(
            SERVICE.ordinary_art_structured_apply_canonical_closure(
                sensual_requirements,
                rejected,
                "一个红色香水瓶陈列在展台上。",
            ),
            [],
        )
        self.assertEqual(rejected, before)
        with self.assertRaises(SERVICE.OrdinaryArtPromptEditNotAppliedError):
            self.run_with_ir(
                sensitive_object_ir() | {"applied_requirements": []},
                requirements=sensual_requirements,
                payload_overrides={
                    "prompt": "一个红色香水瓶陈列在展台上。",
                    "currentPrompt": "一个红色香水瓶陈列在展台上。",
                },
            )

    def test_canonical_closure_rejects_canonical_fact_already_in_source(self):
        requirements = f"用户本次修改要求（最高优先级）：{self.INSTRUCTION}"
        source = f"{self.BASE} 画面质感细腻丰富。"
        direct_ir = implicit_aesthetic_closure_ir(applied_requirements=[])
        before = json.loads(json.dumps(direct_ir, ensure_ascii=False))
        self.assertEqual(
            SERVICE.ordinary_art_structured_apply_canonical_closure(
                requirements,
                direct_ir,
                source,
            ),
            [],
        )
        self.assertEqual(direct_ir, before)
        with self.assertRaises(
            SERVICE.OrdinaryArtPromptEditNotAppliedError
        ) as caught:
            self.run_with_ir(
                implicit_aesthetic_closure_ir(applied_requirements=[]),
                requirements=requirements,
                payload_overrides={"prompt": source, "currentPrompt": source},
            )
        self.assertIn(
            "structured-ledger-",
            caught.exception.diagnostics["applicationReason"],
        )

    def test_grounded_model_ledger_accepts_distinctive_semantic_anchors(self):
        facts = (
            "细腻画面质感与高精度材质层次自然融合",
            "性感华丽的东方幻想女性造型",
            "面向成人向审美的成熟亲密氛围",
        )
        ir = adult_pair_ir(applied_requirements=list(facts))
        ir["style"]["finish"] = facts[0]
        ir["style"]["render_language"] = facts[1]
        ir["style"]["atmosphere"] = facts[2]
        result, calls = self.run_with_ir(
            ir,
            requirements=f"用户本次修改要求（最高优先级）：{self.INSTRUCTION}",
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(result["editContract"], "structured-recompile-v1")
        front = front_five_sections(result["positivePrompt"])
        for fact in facts:
            self.assertIn(fact, front)

    def test_canonical_closure_accepts_neutral_slots_but_rejects_opposites(self):
        unrelated = (
            "手绘数字媒介",
            "东方幻想厚涂语言",
            "温暖亲密氛围",
        )
        clause_specs = SERVICE.ordinary_art_structured_requirement_clause_specs(
            self.INSTRUCTION
        )
        for (clause, direction), fact in zip(clause_specs, unrelated):
            self.assertFalse(
                SERVICE.ordinary_art_structured_requirement_fact_covers(
                    clause,
                    fact,
                    direction=direction,
                )
            )
        ir = adult_pair_ir(applied_requirements=list(unrelated))
        ir["style"]["medium"] = unrelated[0]
        ir["style"]["render_language"] = unrelated[1]
        ir["style"]["atmosphere"] = unrelated[2]
        ir["style"]["finish"] = "皮肤、发丝与丝绸阴影具有自然过渡"
        for subject in ir["subjects"]:
            subject["appearance"] = [
                "精致成熟的东方五官",
                "匀称的成年女性比例",
                "乌黑长发",
            ]
        result, _calls = self.run_with_ir(
            ir,
            requirements=f"用户本次修改要求（最高优先级）：{self.INSTRUCTION}",
        )
        front = front_five_sections(result["positivePrompt"])
        for canonical in (
            "画面质感细腻丰富",
            "人物造型性感且成年比例明确",
            "偏成人向的成熟审美氛围",
        ):
            self.assertIn(canonical, front)

        opposite = (
            "画面质感低劣且材质粗糙",
            "人物造型不性感而且保守",
            "氛围不偏成人向",
        )
        ir = adult_pair_ir(applied_requirements=list(opposite))
        ir["style"]["medium"] = "手绘数字媒介"
        ir["style"]["render_language"] = opposite[1]
        ir["style"]["atmosphere"] = opposite[2]
        ir["style"]["finish"] = opposite[0]
        for subject in ir["subjects"]:
            subject["appearance"] = [
                "精致成熟的东方五官",
                "匀称的成年女性比例",
                "乌黑长发",
            ]
        with self.assertRaises(
            SERVICE.OrdinaryArtPromptEditNotAppliedError
        ) as caught:
            self.run_with_ir(
                ir,
                requirements=f"用户本次修改要求（最高优先级）：{self.INSTRUCTION}",
            )
        self.assertIn(
            "structured-ledger-",
            caught.exception.diagnostics["applicationReason"],
        )

    def test_grounded_model_ledger_rejects_semantic_no_op_facts(self):
        ir = adult_pair_ir()
        source = self.BASE + " " + "。".join(ir["applied_requirements"])
        with self.assertRaises(
            SERVICE.OrdinaryArtPromptEditNotAppliedError
        ) as caught:
            self.run_with_ir(
                ir,
                requirements=(
                    "用户本次修改要求（最高优先级）："
                    f"{self.INSTRUCTION}"
                ),
                payload_overrides={"prompt": source, "currentPrompt": source},
            )
        self.assertEqual(
            caught.exception.diagnostics["applicationReason"],
            "structured-ledger-no-new-fact:C01",
        )

    def test_directional_operation_prefix_keeps_a_grounded_final_state(self):
        fact = "画面质感细腻丰富，材质层次与皮肤高光自然融合"
        ir = adult_pair_ir(applied_requirements=[fact])
        ir["style"]["finish"] = fact
        result, _calls = self.run_with_ir(
            ir,
            requirements="用户本次修改要求（最高优先级）：提高画面质感",
        )
        self.assertEqual(result["editContract"], "structured-recompile-v1")
        self.assertIn(fact, result["positivePrompt"])

    def test_trailing_generic_preservation_is_not_an_edit_ledger_clause(self):
        instruction = "增强材质、光影层次和画面质感，保持主体与构图。"
        self.assertEqual(
            SERVICE.ordinary_art_structured_requirement_clause_specs(instruction),
            [("材质、光影层次和画面质感", "increase")],
        )

        fact = "材质层次清晰，光影层次丰富，画面质感细腻"
        ir = adult_pair_ir(applied_requirements=[fact])
        ir["style"]["finish"] = fact
        result, calls = self.run_with_ir(
            ir,
            requirements=f"用户本次修改要求（最高优先级）：{instruction}",
        )

        self.assertEqual(len(calls), 1)
        self.assertEqual(result["editContract"], "structured-recompile-v1")
        front = front_five_sections(result["positivePrompt"])
        self.assertIn(fact, front)
        self.assertIn("25岁以上的成年东方女性角色A", front)
        self.assertIn("稳定三角构图", front)
        self.assertNotIn("保持主体与构图", result["positivePrompt"])

    def test_trailing_generic_preservation_filter_stays_narrow(self):
        cases = (
            (
                "保持主体与构图",
                [("保持主体与构图", "target")],
            ),
            (
                "增加质感，保持东方女性身份",
                [("质感", "increase"), ("保持东方女性身份", "target")],
            ),
            (
                "保持主体但将构图改为俯视",
                [("保持主体但将构图改为俯视", "target")],
            ),
            (
                "保持原风格基础上增强光影",
                [("保持原风格基础上增强光影", "increase")],
            ),
            (
                "enhance material detail, keep the subject unchanged",
                [("material detail", "increase")],
            ),
            (
                "enhance material detail, keep the subject and composition unchanged",
                [("material detail", "increase")],
            ),
            (
                "增强材质，同时保持主体与构图",
                [("材质", "increase")],
            ),
            (
                "保持主体与构图，增强材质",
                [("材质", "increase")],
            ),
            (
                "增强材质，保持主体与构图，提高光影层次",
                [("材质", "increase"), ("光影层次", "increase")],
            ),
            (
                "enhance material detail and keep the subject and composition unchanged",
                [("material detail", "increase")],
            ),
            (
                "保持主体；维持整体构图不变",
                [("保持主体", "target"), ("维持整体构图不变", "target")],
            ),
            (
                "增强材质，不要改变主体与构图",
                [("材质", "increase"), ("不要改变主体与构图", "decrease")],
            ),
        )
        for instruction, expected in cases:
            with self.subTest(instruction=instruction):
                self.assertEqual(
                    SERVICE.ordinary_art_structured_requirement_clause_specs(
                        instruction
                    ),
                    expected,
                )

    def test_compound_negative_guard_requires_the_same_negative_object(self):
        accepted = (
            ("人物造型性感但不低俗", "人物造型性感但不低俗"),
            ("偏成人向但不过度裸露", "偏成人向但不过度裸露"),
            ("sensual but not vulgar", "sensual but not vulgar"),
            ("性感且无塑料感", "性感且无塑料感"),
            ("质感细腻且无塑料感", "质感细腻且无塑料感"),
            (
                "high material detail without plastic texture",
                "high material detail without plastic texture",
            ),
        )
        rejected = (
            ("人物造型性感但不低俗", "人物造型不性感但不低俗"),
            ("偏成人向但不过度裸露", "不成人向但不过度裸露"),
            ("sensual but not vulgar", "not sensual but not vulgar"),
            ("性感且无塑料感", "不性感且无塑料感"),
            ("质感细腻且无塑料感", "质感粗糙且无塑料感"),
            (
                "high material detail without plastic texture",
                "flat material detail without plastic texture",
            ),
            ("人物造型性感", "人物造型不性感"),
            ("偏成人向", "不偏成人向"),
        )
        for expected, cases in ((True, accepted), (False, rejected)):
            for clause, fact in cases:
                direction = (
                    SERVICE.ordinary_art_structured_requirement_clause_specs(clause)[0][1]
                )
                with self.subTest(expected=expected, clause=clause, fact=fact):
                    self.assertEqual(
                        SERVICE.ordinary_art_structured_requirement_fact_covers(
                            clause,
                            fact,
                            direction=direction,
                        ),
                        expected,
                    )

    def test_english_anchor_requires_all_meaningful_tokens(self):
        clause_specs = SERVICE.ordinary_art_structured_requirement_clause_specs(
            self.ENGLISH_INSTRUCTION
        )
        generic_near_matches = (
            "flat material surfaces",
            "mature character design with elegant styling",
            "mature atmosphere with warm intimate light",
        )
        short_substrings = (
            "material",
            "character design",
            "mature atmosphere",
        )
        self.assertEqual(len(clause_specs), 3)
        for facts in (generic_near_matches, short_substrings):
            for (clause, direction), fact in zip(clause_specs, facts):
                with self.subTest(clause=clause, fact=fact):
                    self.assertFalse(
                        SERVICE.ordinary_art_structured_requirement_fact_covers(
                            clause,
                            fact,
                            direction=direction,
                        )
                    )

    def test_service_english_opposite_fails_but_neutral_short_ledger_closes(self):
        cases = (
            (
                "generic-near-match",
                (
                    "flat material surfaces",
                    "mature character design with elegant styling",
                    "mature atmosphere with warm intimate light",
                ),
                False,
            ),
            (
                "short-substring",
                ("material", "character design", "mature atmosphere"),
                True,
            ),
        )
        for label, facts, expected_success in cases:
            with self.subTest(label=label):
                ir = adult_pair_ir(applied_requirements=list(facts))
                ir["style"]["finish"] = facts[0]
                ir["style"]["render_language"] = facts[1]
                ir["style"]["atmosphere"] = facts[2]
                requirements = (
                    "用户本次修改要求（最高优先级）："
                    f"{self.ENGLISH_INSTRUCTION}"
                )
                if not expected_success:
                    with self.assertRaises(
                        SERVICE.OrdinaryArtPromptEditNotAppliedError
                    ):
                        self.run_with_ir(ir, requirements=requirements)
                    continue
                result, _calls = self.run_with_ir(ir, requirements=requirements)
                front = front_five_sections(result["positivePrompt"])
                for canonical in (
                    "image quality is refined with rich material detail",
                    "character design is sensual with clearly adult proportions",
                    "mature adult-oriented aesthetic atmosphere",
                ):
                    self.assertIn(canonical, front)

    def test_service_compound_polarity_table(self):
        cases = (
            ("人物造型性感但不低俗", "人物造型不性感但不低俗"),
            ("偏成人向但不过度裸露", "不成人向但不过度裸露"),
            ("sensual but not vulgar", "not sensual but not vulgar"),
            ("性感且无塑料感", "不性感且无塑料感"),
            ("质感细腻且无塑料感", "质感粗糙且无塑料感"),
            (
                "high material detail without plastic texture",
                "flat material detail without plastic texture",
            ),
        )
        for clause, opposite in cases:
            with self.subTest(clause=clause):
                valid_ir = self.neutral_single_fact_ir(clause)
                result, _calls = self.run_with_ir(
                    valid_ir,
                    requirements=f"用户本次修改要求（最高优先级）：{clause}",
                )
                self.assertEqual(result["editContract"], "structured-recompile-v1")

                invalid_ir = self.neutral_single_fact_ir(opposite)
                with self.assertRaises(
                    SERVICE.OrdinaryArtPromptEditNotAppliedError
                ) as caught:
                    self.run_with_ir(
                        invalid_ir,
                        requirements=f"用户本次修改要求（最高优先级）：{clause}",
                    )
                self.assertIn(
                    "structured-ledger-",
                    caught.exception.diagnostics["applicationReason"],
                )

    @staticmethod
    def neutral_single_fact_ir(fact: str) -> dict:
        ir = adult_pair_ir(applied_requirements=[fact])
        ir["style"] = {
            "medium": "数字绘画",
            "render_language": "东方幻想游戏CG厚涂与成熟角色造型",
            "atmosphere": "温暖亲密氛围",
            "finish": "皮肤、发丝与丝绸阴影具有自然过渡",
        }
        if re.search(r"(?:质感|材质|material|texture|粗糙|flat)", fact, re.I):
            ir["style"]["finish"] = fact
        elif re.search(r"(?:成人向|adult[-\s]*oriented|mature\s+atmosphere)", fact, re.I):
            ir["style"]["atmosphere"] = fact
        else:
            ir["style"]["render_language"] = fact
        for subject in ir["subjects"]:
            subject["appearance"] = [
                "精致成熟的东方五官",
                "匀称的成年女性比例",
                "乌黑长发",
            ]
        return ir

    def test_empty_optional_instruction_still_structures_in_one_call(self):
        result, calls = self.run_with_ir(
            adult_pair_ir(applied_requirements=[]),
            requirements=(
                "提示词编辑模式：以 prompt / currentPrompt 中的完整原提示词为唯一底稿，"
                "只执行用户明确提出的修改。"
            ),
        )
        self.assertEqual(len(calls), 1)
        self.assertIn("用户本次修改要求：<无>", calls[0]["prompt"])
        self.assertEqual(result["promptSchema"], SCHEMA_VERSION)
        self.assertEqual(
            tuple(
                line.strip()
                for line in result["positivePrompt"].splitlines()
                if line.strip().startswith("[") and line.strip().endswith("]")
            ),
            SECTIONS,
        )

    def test_exact_fixture_closes_missing_safe_clauses_when_only_sexy_is_applied(self):
        ir = adult_pair_ir(applied_requirements=["人物造型性感且比例成熟"])
        ir["style"]["finish"] = "皮肤、发丝与丝绸阴影具有自然过渡"
        ir["style"]["atmosphere"] = "温暖亲密氛围"
        result, _calls = self.run_with_ir(
            ir,
            requirements=f"用户本次修改要求（最高优先级）：{self.INSTRUCTION}",
        )
        front = front_five_sections(result["positivePrompt"])
        for canonical in (
            "画面质感细腻丰富",
            "人物造型性感且成年比例明确",
            "偏成人向的成熟审美氛围",
        ):
            self.assertIn(canonical, front)

    def test_multi_subject_empty_relation_uses_ir_subject_facts_only(self):
        ir = adult_pair_ir(applied_requirements=[])
        ir["relations"] = []
        ir["environment"]["support_surface"] = ""
        ir["environment"]["occlusion"] = []
        ir["lighting_color"]["rim_light"] = ""
        ir["camera"]["crop"] = ""
        base = (
            self.BASE
            + " Do not kiss. Kiss count = 0. Left side contains debug metadata."
        )
        result, calls = self.run_with_ir(
            ir,
            requirements="",
            payload_overrides={"prompt": base, "currentPrompt": base},
        )
        self.assertEqual(len(calls), 1)
        self.assertIn("主体关系 = ", result["positivePrompt"])
        self.assertIn("亲密依偎", result["positivePrompt"])
        for raw_source_phrase in (
            "Do not kiss",
            "Kiss count = 0",
            "Left side contains debug metadata",
        ):
            self.assertNotIn(raw_source_phrase, result["positivePrompt"])
        self.assertIn("明亮雅致的东方幻想宫廷室内中的承托关系清晰稳定", result["positivePrompt"])
        self.assertIn("淡金屏风与半透明帷幔形成简洁背景保持空间层次", result["positivePrompt"])
        self.assertIn("暖光从画面左上方斜射", result["positivePrompt"])
        self.assertIn("柔和高调光线，亮部不过曝自然塑造主体边缘", result["positivePrompt"])
        self.assertIn("按近距离双人全身景别完整保留主体与关键动作", result["positivePrompt"])

    def test_empty_structural_slots_never_copy_raw_source_into_wrong_fields(self):
        ir = adult_pair_ir(applied_requirements=[])
        ir["environment"]["support_surface"] = ""
        ir["environment"]["occlusion"] = []
        ir["lighting_color"]["rim_light"] = ""
        ir["camera"]["crop"] = ""
        source_only_phrases = (
            "Do not crop the figures",
            "A polished stone wall fills the background",
            "High surface detail covers the skin",
            "Layered silk shading crosses the frame",
            "A full-body tattoo remains visible",
        )
        base = self.BASE + " " + ". ".join(source_only_phrases) + "."
        result, _calls = self.run_with_ir(
            ir,
            requirements="",
            payload_overrides={"prompt": base, "currentPrompt": base},
        )
        for phrase in source_only_phrases:
            self.assertNotIn(phrase, result["positivePrompt"])
        self.assertIn("明亮雅致的东方幻想宫廷室内中的承托关系清晰稳定", result["positivePrompt"])
        self.assertIn("淡金屏风与半透明帷幔形成简洁背景保持空间层次", result["positivePrompt"])
        self.assertIn("柔和高调光线，亮部不过曝自然塑造主体边缘", result["positivePrompt"])
        self.assertIn("按近距离双人全身景别完整保留主体与关键动作", result["positivePrompt"])

    def test_service_rejects_non_final_front_field_values_before_signing(self):
        cases = (
            (("camera", "crop"), "Do not crop the figures."),
            (("environment", "occlusion"), ["Without occlusions."]),
            (("relations",), ["Do not kiss."]),
            (("style", "finish"), "Here is the optimized prompt."),
            (("style", "finish"), "Keep the characters visible."),
            (("camera", "crop"), "Ensure the figures remain in frame."),
            (("style", "finish"), "Below is the final prompt."),
            (("style", "finish"), "visual note: Keep the characters visible."),
            (("style", "finish"), "visual note: Without occlusions."),
            (("style", "finish"), "visual note: Below is the final prompt."),
            (("camera", "crop"), "Please do not crop the figures."),
            (("style", "finish"), "Please preserve the image style."),
            (("lighting_color", "light_shadow"), "Should decrease exposure."),
            (("environment", "background"), "Needed to change the background."),
            (("lighting_color", "light_shadow"), "需提高曝光。"),
            (("style", "finish"), "需要保留人物。"),
            (("style", "render_language"), "保留风格。"),
            (("subjects", 0, "details"), ["务必补充细节。"]),
            (("style", "finish"), "visual note preserve the image style."),
        )
        for path, invalid_value in cases:
            with self.subTest(path=path, invalid_value=invalid_value):
                ir = adult_pair_ir(applied_requirements=[])
                target = ir
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = invalid_value
                with self.assertRaises(
                    SERVICE.OrdinaryArtPromptEditNotAppliedError
                ) as caught:
                    self.run_with_ir(ir, requirements="")
                self.assertIn(
                    "art-prompt-contract-meta-instruction",
                    caught.exception.diagnostics["applicationReason"],
                )

    def test_english_three_clause_edit_uses_three_final_state_ledger_facts(self):
        finish = (
            "high material detail with natural skin highlights and layered silk shading"
        )
        render_language = (
            "premium fantasy game painting, sensual mature character design"
        )
        atmosphere = (
            "mature adult-oriented atmosphere with warm intimate lighting"
        )
        ir = adult_pair_ir(applied_requirements=[
            finish,
            render_language,
            atmosphere,
        ])
        ir["style"]["finish"] = finish
        ir["style"]["render_language"] = render_language
        ir["style"]["atmosphere"] = atmosphere
        result, calls = self.run_with_ir(
            ir,
            requirements=(
                "用户本次修改要求（最高优先级）："
                f"{self.ENGLISH_INSTRUCTION}"
            ),
        )
        self.assertEqual(len(calls), 1)
        front = front_five_sections(result["positivePrompt"])
        for fact in ir["applied_requirements"]:
            self.assertIn(fact, front)

    def test_english_three_clause_edit_replaces_one_aggregate_ledger_fact(self):
        aggregate = (
            "high material detail; sensual mature character design; "
            "mature adult-oriented atmosphere"
        )
        ir = adult_pair_ir(applied_requirements=[aggregate])
        ir["style"]["render_language"] = aggregate
        requirements = (
            "用户本次修改要求（最高优先级）："
            f"{self.ENGLISH_INSTRUCTION}"
        )
        self.assertEqual(
            SERVICE.ordinary_art_structured_requirement_ledger_failure(
                requirements,
                [aggregate],
                grounded_mapping=True,
            ),
            "structured-ledger-count:1/3",
        )
        result, _calls = self.run_with_ir(ir, requirements=requirements)
        front = front_five_sections(result["positivePrompt"])
        for canonical in (
            "image quality is refined with rich material detail",
            "character design is sensual with clearly adult proportions",
            "mature adult-oriented aesthetic atmosphere",
        ):
            self.assertIn(canonical, front)

    def test_exact_schema_without_exact_art_surface_stays_on_legacy_branch(self):
        payload = self.payload(requirements="")
        payload["surface"] = ""
        self.assertFalse(SERVICE.is_ordinary_art_structured_recompile_payload(
            payload,
            self.BASE,
            is_ordinary_art=True,
            is_create=False,
        ))
        payload["surface"] = "art"
        payload["currentPrompt"] = ""
        self.assertFalse(SERVICE.is_ordinary_art_structured_recompile_payload(
            payload,
            self.BASE,
            is_ordinary_art=True,
            is_create=False,
        ))

    def test_terminal_only_echo_is_replaced_by_canonical_front_facts(self):
        ir = adult_pair_ir(applied_requirements=[], terminal_constraints=[
            "画面目标：人物造型性感、画面质感丰富、成熟成人氛围",
        ])
        ir["style"]["render_language"] = "东方幻想游戏CG厚涂"
        ir["style"]["atmosphere"] = "温暖亲密氛围"
        ir["style"]["finish"] = "皮肤、发丝和丝绸具有自然过渡"
        for subject in ir["subjects"]:
            subject["appearance"] = ["精致成熟的东方五官", "匀称的成年女性造型", "乌黑长发"]
        result, _calls = self.run_with_ir(
            ir,
            requirements=f"用户本次修改要求（最高优先级）：{self.INSTRUCTION}",
        )
        front = front_five_sections(result["positivePrompt"])
        for canonical in (
            "画面质感细腻丰富",
            "人物造型性感且成年比例明确",
            "偏成人向的成熟审美氛围",
        ):
            self.assertIn(canonical, front)

    def test_missing_resource_placeholder_fails_closed(self):
        base = f"{self.BASE} 主体服装参考 __NOVAFLOW_RESOURCE_1__。"
        assistant = SERVICE.PromptAssistant()
        assistant.generate = lambda _prompt, **_kwargs: json.dumps(
            adult_pair_ir(applied_requirements=[]), ensure_ascii=False, separators=(",", ":")
        )
        payload = self.payload(requirements="")
        payload["prompt"] = base
        payload["currentPrompt"] = base
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
            assistant.optimize_prompt(payload)
        self.assertEqual(
            caught.exception.diagnostics["retentionReason"],
            "structured-resource-token-mismatch",
        )

    def test_non_targeted_named_hard_block_must_survive_terminal_section(self):
        base = (
            f"{self.BASE}\n\n"
            "要求：两张脸必须明显不同，四只手结构正确且归属明确。"
        )
        assistant = SERVICE.PromptAssistant()
        assistant.generate = lambda _prompt, **_kwargs: json.dumps(
            adult_pair_ir(applied_requirements=[
                "画面质感细腻丰富，皮肤高光、发丝与丝绸阴影自然过渡",
            ], terminal_constraints=[
                "两位人物必须保持25岁以上的明确成年东方女性身份",
            ]),
            ensure_ascii=False,
            separators=(",", ":"),
        )
        payload = self.payload(requirements="用户本次修改要求（最高优先级）：增强皮肤质感")
        payload["prompt"] = base
        payload["currentPrompt"] = base
        result = assistant.optimize_prompt(payload)
        front = front_five_sections(result["positivePrompt"])
        terminal = result["positivePrompt"].split("[用户附加要求]", 1)[1]
        self.assertIn("两张脸必须明显不同", front)
        self.assertIn("四只手结构正确且归属明确", front)
        self.assertIn("两张脸必须明显不同", terminal)
        self.assertIn("四只手结构正确且归属明确", terminal)

    def test_visible_hard_colored_garment_and_hat_are_front_grounded(self):
        chinese_source = (
            "要求：左侧角色必须穿红色裙装；禁止任何角色戴帽子。"
        )
        legal, _calls = self.run_with_ir(
            visible_hard_pair_ir(),
            requirements="",
            payload_overrides={"prompt": chinese_source, "currentPrompt": chinese_source},
        )
        self.assertIn("红色裙装", front_five_sections(legal["positivePrompt"]))

        blue_with_red_earring = visible_hard_pair_ir(
            left_garment="蓝色裙装",
            left_extra=["红色耳饰高光清晰"],
        )
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
            self.run_with_ir(
                blue_with_red_earring,
                requirements="",
                payload_overrides={"prompt": chinese_source, "currentPrompt": chinese_source},
            )
        self.assertIn(
            "structured-visible-hard-positive-missing:red-dress",
            caught.exception.diagnostics["retentionReason"],
        )

        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
            self.run_with_ir(
                visible_hard_pair_ir(right_extra=["右侧角色佩戴黑色帽子"]),
                requirements="",
                payload_overrides={"prompt": chinese_source, "currentPrompt": chinese_source},
            )
        self.assertIn(
            "structured-visible-hard-negative-conflict:hat",
            caught.exception.diagnostics["retentionReason"],
        )

        english_source = (
            "Requirements: the left character must wear a red dress; "
            "no character may wear a hat."
        )
        self.run_with_ir(
            visible_hard_pair_ir(),
            requirements="",
            payload_overrides={"prompt": english_source, "currentPrompt": english_source},
        )
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError):
            self.run_with_ir(
                visible_hard_pair_ir(left_garment="blue dress", right_extra=["black hat"]),
                requirements="",
                payload_overrides={"prompt": english_source, "currentPrompt": english_source},
            )

    def test_visible_hard_color_object_binding_is_phrase_local(self):
        source = "要求：左侧角色必须穿红色裙装。"
        self.run_with_ir(
            visible_hard_pair_ir(
                left_garment="左侧角色穿红色裙装搭配蓝色上衣",
            ),
            requirements="",
            payload_overrides={"prompt": source, "currentPrompt": source},
        )
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
            self.run_with_ir(
                visible_hard_pair_ir(
                    left_garment="左侧角色穿红色上衣搭配蓝色裙装",
                ),
                requirements="",
                payload_overrides={"prompt": source, "currentPrompt": source},
            )
        self.assertIn(
            "structured-visible-hard-positive-missing:red-dress",
            caught.exception.diagnostics["retentionReason"],
        )

        negative_source = "禁止：任何角色佩戴红色帽子。"
        self.run_with_ir(
            visible_hard_pair_ir(
                left_extra=["左侧角色佩戴红色耳饰与蓝色帽子"],
            ),
            requirements="",
            payload_overrides={"prompt": negative_source, "currentPrompt": negative_source},
        )
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
            self.run_with_ir(
                visible_hard_pair_ir(
                    left_extra=["左侧角色佩戴蓝色耳饰与红色帽子"],
                ),
                requirements="",
                payload_overrides={"prompt": negative_source, "currentPrompt": negative_source},
            )
        self.assertIn(
            "structured-visible-hard-negative-conflict:red-hat",
            caught.exception.diagnostics["retentionReason"],
        )

    def test_visible_hard_negative_object_uses_match_local_absence_polarity(self):
        source = "禁止：任何角色戴帽子。"
        for final_fact in (
            "未佩戴帽子",
            "帽子未出现",
            "帽子不得出现",
            "帽子不存在",
            "hat is absent",
            "hat absent",
        ):
            with self.subTest(final_fact=final_fact):
                self.run_with_ir(
                    visible_hard_pair_ir(left_extra=[final_fact]),
                    requirements="",
                    payload_overrides={"prompt": source, "currentPrompt": source},
                )
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
            self.run_with_ir(
                visible_hard_pair_ir(left_extra=["帽子不能遮挡脸"]),
                requirements="",
                payload_overrides={"prompt": source, "currentPrompt": source},
            )
        self.assertIn(
            "structured-visible-hard-negative-conflict:hat",
            caught.exception.diagnostics["retentionReason"],
        )

    def test_visible_hard_positive_anchor_requires_local_affirmation(self):
        source = "要求：背景必须为雪山；视角必须为俯视；绘画媒介必须为数字绘画。"
        legal = visible_hard_pair_ir()
        legal["environment"]["background"] = "清晰雪山背景与远处云层"
        legal["camera"]["angle"] = "略微俯视视角"
        legal["style"]["medium"] = "高精度数字绘画"
        self.run_with_ir(
            legal,
            requirements="",
            payload_overrides={"prompt": source, "currentPrompt": source},
        )
        mutations = (
            ("environment", lambda ir: ir["environment"].update({"background": "不是雪山而是宫殿背景"})),
            ("camera", lambda ir: ir["camera"].update({"angle": "不是俯视而是平视视角"})),
            ("style", lambda ir: ir["style"].update({"medium": "不是数字绘画而是写实摄影媒介"})),
        )
        for kind, mutate in mutations:
            with self.subTest(kind=kind):
                wrong = json.loads(json.dumps(legal, ensure_ascii=False))
                mutate(wrong)
                with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError):
                    self.run_with_ir(
                        wrong,
                        requirements="",
                        payload_overrides={"prompt": source, "currentPrompt": source},
                    )

    def test_visible_hard_rejects_front_opposites_after_typed_closure(self):
        body_source = "要求：四只手结构正确且归属明确。"
        body_wrong = visible_hard_pair_ir()
        body_wrong["subjects"][0]["details"].append("两只手结构清晰")
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
            self.run_with_ir(
                body_wrong,
                requirements="",
                payload_overrides={"prompt": body_source, "currentPrompt": body_source},
            )
        self.assertIn(
            "structured-visible-hard-positive-conflict:hand-count:2/4",
            caught.exception.diagnostics["retentionReason"],
        )

        face_source = "要求：两张脸必须具有明显不同的五官特征。"
        face_wrong = visible_hard_pair_ir()
        face_wrong["subjects"][0]["appearance"].append("两张脸完全相同且五官一致")
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
            self.run_with_ir(
                face_wrong,
                requirements="",
                payload_overrides={"prompt": face_source, "currentPrompt": face_source},
            )
        self.assertIn(
            "structured-visible-hard-positive-conflict:distinct-faces",
            caught.exception.diagnostics["retentionReason"],
        )
        face_reference_wrong = visible_hard_pair_ir()
        face_reference_wrong["subjects"][1]["appearance"].append("与角色A五官一致")
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError):
            self.run_with_ir(
                face_reference_wrong,
                requirements="",
                payload_overrides={"prompt": face_source, "currentPrompt": face_source},
            )
        self.run_with_ir(
            visible_hard_pair_ir(left_extra=["两人肤色一致，光照过渡自然"]),
            requirements="",
            payload_overrides={"prompt": face_source, "currentPrompt": face_source},
        )

        identity_source = "两位25岁以上的成年东方女性角色。"
        identity_conflicts = (
            ("gender", "成熟东方男性角色，成年男性"),
            ("region", "成熟西方女性角色，欧洲女性五官"),
            ("minor", "未成年东方女性角色，儿童比例"),
        )
        for kind, appearance in identity_conflicts:
            with self.subTest(kind=kind):
                wrong = visible_hard_pair_ir()
                wrong["subjects"][0]["appearance"].append(appearance)
                with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
                    self.run_with_ir(
                        wrong,
                        requirements="",
                        payload_overrides={"prompt": identity_source, "currentPrompt": identity_source},
                    )
                self.assertIn(
                    f"structured-source-identity-conflict:{kind}",
                    caught.exception.diagnostics["retentionReason"],
                )

    def test_source_visible_manifest_rejects_wholesale_front_drift(self):
        source = (
            "两位25岁以上的成年东方女性角色亲密依偎。"
            "左侧角色身穿青绿色丝绸服饰，右侧角色身穿象牙白与淡金色薄纱服饰。"
            "柔和暖光从左侧照入，淡金宫廷屏风与帷幔构成背景。"
            "采用近距离双人全身景别与略微俯视视角。"
        )
        legal = adult_pair_ir(applied_requirements=[])
        self.run_with_ir(
            legal,
            requirements="",
            payload_overrides={"prompt": source, "currentPrompt": source},
        )

        wrong = json.loads(json.dumps(legal, ensure_ascii=False))
        wrong["subjects"][0]["colors"] = ["红色皮革服装", "白皙肤色"]
        wrong["subjects"][0]["materials"] = ["红色皮革", "金属配件"]
        wrong["subjects"][1]["colors"] = ["黑色铠甲", "冷白肤色"]
        wrong["subjects"][1]["materials"] = ["黑色金属", "硬质皮革"]
        wrong["environment"]["setting"] = "幽暗森林深处"
        wrong["environment"]["background"] = "密集树林与黑色岩石"
        wrong["lighting_color"]["light_direction"] = "冷光从画面右侧照入"
        wrong["lighting_color"]["light_quality"] = "硬质冷光与强烈阴影"
        wrong["camera"]["shot"] = "中近景半身景别"
        wrong["camera"]["angle"] = "平视视角"
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
            self.run_with_ir(
                wrong,
                requirements="",
                payload_overrides={"prompt": source, "currentPrompt": source},
            )
        self.assertIn(
            "structured-source-visible-missing:subject-color-object:left-green-clothing",
            caught.exception.diagnostics["retentionReason"],
        )

        wrong_color_binding = json.loads(json.dumps(legal, ensure_ascii=False))
        wrong_color_binding["subjects"][0]["colors"] = [
            "青绿色耳饰",
            "红色丝绸服饰",
        ]
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError):
            self.run_with_ir(
                wrong_color_binding,
                requirements="",
                payload_overrides={"prompt": source, "currentPrompt": source},
            )

        wrong_material_binding = json.loads(json.dumps(legal, ensure_ascii=False))
        wrong_material_binding["subjects"][0]["materials"] = [
            "青绿色丝绸发带",
            "红色皮革服饰",
        ]
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
            self.run_with_ir(
                wrong_material_binding,
                requirements="",
                payload_overrides={"prompt": source, "currentPrompt": source},
            )
        self.assertIn(
            "structured-source-visible-missing:subject-material-object:left-delicate-fabric-clothing",
            caught.exception.diagnostics["retentionReason"],
        )

        targeted = json.loads(json.dumps(legal, ensure_ascii=False))
        targeted["subjects"][0]["colors"] = ["红色皮革服装", "白皙肤色"]
        targeted["subjects"][0]["materials"] = ["红色皮革", "金属配件"]
        targeted["applied_requirements"] = ["红色皮革服装"]
        requirements = "用户本次修改要求（最高优先级）：将左侧青绿色丝绸服饰改为红色皮革服装"
        self.run_with_ir(
            targeted,
            requirements=requirements,
            payload_overrides={"prompt": source, "currentPrompt": source},
        )

        partial = json.loads(json.dumps(legal, ensure_ascii=False))
        partial["subjects"][0]["colors"] = ["红色皮革服装", "白皙肤色"]
        partial["subjects"][0]["materials"] = ["红色皮革", "金属配件"]
        partial["applied_requirements"] = ["红色皮革服装"]
        partial_requirements = "用户本次修改要求（最高优先级）：将左侧服装材质调整为红色皮革"
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError):
            self.run_with_ir(
                partial,
                requirements=partial_requirements,
                payload_overrides={"prompt": source, "currentPrompt": source},
            )

    def test_source_visible_manifest_target_scope_is_field_local(self):
        identity = "两位25岁以上的成年东方女性角色。"

        environment_source = (
            identity
            + "明亮宫廷空间，淡金屏风构成背景，人物坐在丝绸床榻上。"
        )
        environment_wrong = adult_pair_ir(applied_requirements=["蓝色屏风构成背景"])
        environment_wrong["environment"]["setting"] = "幽暗森林空间"
        environment_wrong["environment"]["background"] = "蓝色屏风构成背景"
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError):
            self.run_with_ir(
                environment_wrong,
                requirements="用户本次修改要求（最高优先级）：将背景色调整为蓝色",
                payload_overrides={
                    "prompt": environment_source,
                    "currentPrompt": environment_source,
                },
            )

        lighting_source = identity + "暖光从画面左侧照入。"
        lighting_wrong = adult_pair_ir(applied_requirements=["光线色温为冷色"])
        lighting_wrong["lighting_color"]["light_direction"] = "光源从画面右侧照入"
        lighting_wrong["lighting_color"]["palette"] = ["光线色温为冷色", "青绿色", "象牙白"]
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError):
            self.run_with_ir(
                lighting_wrong,
                requirements="用户本次修改要求（最高优先级）：将光线色温调整为冷色",
                payload_overrides={
                    "prompt": lighting_source,
                    "currentPrompt": lighting_source,
                },
            )

        camera_source = identity + "采用双人全身景别、俯视视角与浅景深。"
        camera_wrong = adult_pair_ir(applied_requirements=["深景深，背景细节清晰"])
        camera_wrong["camera"]["shot"] = "中近景半身景别"
        camera_wrong["camera"]["depth_of_field"] = "深景深，背景细节清晰"
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError):
            self.run_with_ir(
                camera_wrong,
                requirements="用户本次修改要求（最高优先级）：将景深调整为深景深",
                payload_overrides={
                    "prompt": camera_source,
                    "currentPrompt": camera_source,
                },
            )

    def test_source_visible_manifest_carries_locator_only_within_sentence(self):
        self.assertEqual(
            SERVICE.ordinary_art_structured_source_visible_segments(
                "左侧女性身穿青绿色华服，服装采用轻薄丝纱。"
                "另一段只描述蕾丝纹理。"
            ),
            [
                "左侧女性身穿青绿色华服",
                "左侧角色服装采用轻薄丝纱",
                "另一段只描述蕾丝纹理",
            ],
        )
        self.assertEqual(
            SERVICE.ordinary_art_structured_source_visible_segments(
                "左侧女性身穿青绿色华服，服装采用轻薄丝纱。\n"
                "下一段只描述蕾丝纹理。"
            )[-1],
            "下一段只描述蕾丝纹理",
        )
        source = (
            "两位25岁以上的成年东方女性角色。"
            "左侧女性身穿青绿色中国幻想华服，"
            "服装融合古典汉服、轻薄丝纱与高级游戏角色设计。"
            "右侧女性身穿象牙白与淡金色中国幻想华服，"
            "精致金色刺绣、花纹蕾丝、半透明薄纱与玉石首饰。"
        )
        legal = adult_pair_ir(applied_requirements=[])
        self.run_with_ir(
            legal,
            requirements="",
            payload_overrides={"prompt": source, "currentPrompt": source},
        )
        for index, side in ((0, "left"), (1, "right")):
            with self.subTest(side=side):
                wrong = json.loads(json.dumps(legal, ensure_ascii=False))
                wrong["subjects"][index]["materials"] = [
                    "硬质皮革服饰",
                    "抛光金属配件",
                ]
                if side == "right":
                    wrong["subjects"][index]["colors"][0] = "象牙白与淡金色服饰"
                with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
                    self.run_with_ir(
                        wrong,
                        requirements="",
                        payload_overrides={"prompt": source, "currentPrompt": source},
                    )
                self.assertIn(
                    f"structured-source-visible-missing:subject-material-object:{side}-delicate-fabric-clothing",
                    caught.exception.diagnostics["retentionReason"],
                )

    def test_visible_hard_locator_rejects_swapped_left_and_right_garments(self):
        source = (
            "要求：左侧角色必须穿红色裙装；右侧角色必须穿白色裙装。"
        )
        self.run_with_ir(
            visible_hard_pair_ir(),
            requirements="",
            payload_overrides={"prompt": source, "currentPrompt": source},
        )
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
            self.run_with_ir(
                visible_hard_pair_ir(
                    left_garment="白色裙装",
                    right_garment="红色裙装",
                ),
                requirements="",
                payload_overrides={"prompt": source, "currentPrompt": source},
            )
        self.assertIn(
            "structured-visible-hard-positive-missing:red-dress",
            caught.exception.diagnostics["retentionReason"],
        )

    def test_visible_hard_negative_concepts_reject_only_affirmative_conflicts(self):
        source = "避免：3D渲染；塑料皮肤；复制脸；错误肢体。"
        self.run_with_ir(
            visible_hard_pair_ir(),
            requirements="",
            payload_overrides={"prompt": source, "currentPrompt": source},
        )
        conflict_builders = {
            "3d-render": lambda ir: ir["style"].update({"medium": "3D render"}),
            "plastic-skin": lambda ir: ir["style"].update({
                "finish": "塑料皮肤表面具有坚硬材质反光与锐利高光",
            }),
            "duplicate-face": lambda ir: ir["relations"].append(
                "两张脸完全相同，呈现明显复制脸"
            ),
            "bad-anatomy": lambda ir: ir["relations"].append(
                "人物具有错误肢体结构与融合手臂"
            ),
        }
        for kind, mutate in conflict_builders.items():
            with self.subTest(kind=kind):
                ir = visible_hard_pair_ir()
                mutate(ir)
                with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
                    self.run_with_ir(
                        ir,
                        requirements="",
                        payload_overrides={"prompt": source, "currentPrompt": source},
                    )
                self.assertIn(
                    f"structured-visible-hard-negative-conflict:{kind}",
                    caught.exception.diagnostics["retentionReason"],
                )

        two_d = visible_hard_pair_ir()
        two_d["style"]["medium"] = "数字插画"
        two_d["style"]["render_language"] = "高级复杂2D动漫厚涂渲染"
        self.run_with_ir(
            two_d,
            requirements="",
            payload_overrides={"prompt": "避免：3D渲染。", "currentPrompt": "避免：3D渲染。"},
        )
        nuanced = visible_hard_pair_ir()
        nuanced["style"]["render_language"] = "高级复杂赛璐璐渲染与商业游戏角色设计"
        nuanced_source = "避免：简单赛璐璐；廉价网游风。"
        self.run_with_ir(
            nuanced,
            requirements="",
            payload_overrides={"prompt": nuanced_source, "currentPrompt": nuanced_source},
        )

    def test_visible_hard_positive_domains_are_bound_to_exact_front_slots(self):
        source = (
            "要求：两位人物必须站立；背景必须为雪山；光源必须从左侧照入。"
        )
        wrong = visible_hard_pair_ir()
        wrong["lighting_color"]["light_direction"] = "光源从画面右侧斜射"
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError):
            self.run_with_ir(
                wrong,
                requirements="",
                payload_overrides={"prompt": source, "currentPrompt": source},
            )

        legal = visible_hard_pair_ir()
        for subject in legal["subjects"]:
            subject["pose"] = "站立姿态，身体比例自然"
        legal["environment"]["background"] = "清晰雪山背景与远处云层"
        legal["lighting_color"]["light_direction"] = "光源从画面左侧斜射入"
        self.run_with_ir(
            legal,
            requirements="",
            payload_overrides={"prompt": source, "currentPrompt": source},
        )

        compound = "要求：两位人物必须站在雪山背景，光源必须从左侧照入。"
        wrong_light = json.loads(json.dumps(legal, ensure_ascii=False))
        wrong_light["lighting_color"]["light_direction"] = "光源从画面右侧斜射入"
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
            self.run_with_ir(
                wrong_light,
                requirements="",
                payload_overrides={"prompt": compound, "currentPrompt": compound},
            )
        self.assertIn(
            "structured-visible-hard-positive-missing:light-left",
            caught.exception.diagnostics["retentionReason"],
        )

        wrong_pose = json.loads(json.dumps(legal, ensure_ascii=False))
        for subject in wrong_pose["subjects"]:
            subject["pose"] = "坐姿，身体比例自然"
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
            self.run_with_ir(
                wrong_pose,
                requirements="",
                payload_overrides={"prompt": compound, "currentPrompt": compound},
            )
        self.assertIn(
            "structured-visible-hard-positive-missing:standing",
            caught.exception.diagnostics["retentionReason"],
        )

    def test_visible_hard_compound_garment_does_not_skip_pose(self):
        source = "要求：左侧角色必须穿红色裙装并保持站立。"
        sitting = visible_hard_pair_ir()
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
            self.run_with_ir(
                sitting,
                requirements="",
                payload_overrides={"prompt": source, "currentPrompt": source},
            )
        self.assertIn(
            "structured-visible-hard-positive-missing:standing",
            caught.exception.diagnostics["retentionReason"],
        )
        standing = visible_hard_pair_ir()
        standing["subjects"][0]["pose"] = "左侧角色保持站立姿态"
        self.run_with_ir(
            standing,
            requirements="",
            payload_overrides={"prompt": source, "currentPrompt": source},
        )

    def test_visible_hard_camera_and_style_atoms_use_their_exact_slots(self):
        source = (
            "要求：景别必须为近距离全身；视角必须俯视；构图必须为三角构图；"
            "透视必须标准透视；景深必须浅景深；绘画媒介必须数字绘画。"
        )
        legal = visible_hard_pair_ir()
        legal["style"]["medium"] = "数字绘画"
        legal["camera"].update({
            "shot": "近距离全身景别",
            "angle": "俯视视角",
            "composition": "三角构图",
            "perspective": "标准透视",
            "depth_of_field": "浅景深，人物主体清晰",
        })
        self.run_with_ir(
            legal,
            requirements="",
            payload_overrides={"prompt": source, "currentPrompt": source},
        )
        wrong = json.loads(json.dumps(legal, ensure_ascii=False))
        wrong["camera"]["angle"] = "低角度仰视视角"
        wrong["subjects"][0]["details"].append("发饰位于画面俯视方向的上方")
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
            self.run_with_ir(
                wrong,
                requirements="",
                payload_overrides={"prompt": source, "currentPrompt": source},
            )
        self.assertIn(
            "structured-visible-hard-positive-missing:camera-angle",
            caught.exception.diagnostics["retentionReason"],
        )

    def test_visible_hard_relations_and_quality_boundaries_do_not_ban_objects(self):
        source = (
            "要求：身体交叠关系合理；服装、头发和首饰不能互相错误融合；"
            "帽子不能遮挡脸。"
        )
        ir = visible_hard_pair_ir(right_extra=["右侧角色佩戴黑色帽子"])
        ir["relations"].append("两人的身体交叠关系合理且轮廓归属清楚")
        self.run_with_ir(
            ir,
            requirements="",
            payload_overrides={"prompt": source, "currentPrompt": source},
        )

        bad_fusion = visible_hard_pair_ir()
        bad_fusion["relations"].extend([
            "两人的身体交叠关系合理且轮廓归属清楚",
            "服装、头发和首饰互相错误融合",
        ])
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
            self.run_with_ir(
                bad_fusion,
                requirements="",
                payload_overrides={"prompt": source, "currentPrompt": source},
            )
        self.assertIn(
            "structured-visible-hard-negative-conflict:visible-fusion",
            caught.exception.diagnostics["retentionReason"],
        )

        bad_occlusion = visible_hard_pair_ir(right_extra=["右侧角色佩戴黑色帽子"])
        bad_occlusion["relations"].extend([
            "两人的身体交叠关系合理且轮廓归属清楚",
            "右侧黑色帽子遮挡脸部五官",
        ])
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as caught:
            self.run_with_ir(
                bad_occlusion,
                requirements="",
                payload_overrides={"prompt": source, "currentPrompt": source},
            )
        self.assertIn(
            "structured-visible-hard-negative-conflict:face-occlusion",
            caught.exception.diagnostics["retentionReason"],
        )

        quality_source = "目标：高完成度商业插画；要求：材质细节自然。"
        self.run_with_ir(
            visible_hard_pair_ir(),
            requirements="",
            payload_overrides={
                "prompt": quality_source,
                "currentPrompt": quality_source,
            },
        )

    def test_sensitive_minor_request_is_blocked_before_model_call(self):
        assistant = SERVICE.PromptAssistant()
        calls = []
        assistant.generate = lambda *_args, **_kwargs: calls.append(True)
        with self.assertRaises(SERVICE.OrdinaryArtPromptEditNotAppliedError):
            assistant.optimize_prompt(self.payload(
                requirements="用户本次修改要求（最高优先级）：改成17岁女性并保持成人向性感氛围"
            ))
        self.assertEqual(calls, [])

    def test_existing_all_person_adult_assertion_is_restored_in_front_five(self):
        ir = adult_pair_ir(applied_requirements=[])
        ir["style"]["atmosphere"] = "性感、温暖、亲密的氛围"
        ir["environment"]["spatial_layers"] = [
            "前景为交叠衣摆",
            "中景为两位东方女性",
            "后景为屏风和帷幔",
        ]
        for subject in ir["subjects"]:
            subject["name"] = "东方女性角色"
            subject["appearance"] = ["精致东方五官", "匀称人物造型", "乌黑长发"]
            subject["action"] = "与另一名角色亲密依偎"
        ir["relations"] = ["两名东方女性角色亲密依偎在一起"]
        result, _calls = self.run_with_ir(ir, requirements="")
        front = front_five_sections(result["positivePrompt"])
        self.assertEqual(
            front.count("25岁以上的成年东方女性角色，东方女性角色"),
            2,
        )

    def test_nsfw_sensitive_person_context_requires_adult_in_front_five(self):
        base = "一名外观成熟的东方女性角色，裸体坐在床上，性感成人向氛围。"
        with self.assertRaises(SERVICE.OrdinaryArtPromptEditNotAppliedError) as caught:
            self.run_with_ir(
                sensitive_pair_ir_without_adult_identity(),
                requirements="",
                payload_overrides={"prompt": base, "currentPrompt": base},
            )
        self.assertEqual(
            caught.exception.diagnostics["applicationReason"],
            "structured-adult-assertion-missing-from-front",
        )

    def test_nsfw_sensitive_person_context_accepts_explicit_adult_front(self):
        base = "一名外观成熟的东方女性角色，裸体坐在床上，性感成人向氛围。"
        result, _calls = self.run_with_ir(
            adult_pair_ir(applied_requirements=[]),
            requirements="",
            payload_overrides={"prompt": base, "currentPrompt": base},
        )
        self.assertIn("成年", front_five_sections(result["positivePrompt"]))

    def test_negative_minor_exclusion_does_not_substitute_for_adult_identity(self):
        base = "一名外观成熟的东方女性角色，裸体坐在床上，性感成人向氛围。"
        ir = sensitive_pair_ir_without_adult_identity()
        ir["terminal_constraints"].append("禁止未成年人")
        with self.assertRaises(SERVICE.OrdinaryArtPromptEditNotAppliedError) as caught:
            self.run_with_ir(
                ir,
                requirements="",
                payload_overrides={"prompt": base, "currentPrompt": base},
            )
        self.assertEqual(
            caught.exception.diagnostics["applicationReason"],
            "structured-adult-assertion-missing-from-front",
        )

    def test_nsfw_false_does_not_add_adult_requirement_to_sensitive_person(self):
        base = "一名外观成熟的东方女性角色，裸体坐在床上，性感成人向氛围。"
        result, _calls = self.run_with_ir(
            sensitive_pair_ir_without_adult_identity(),
            requirements="",
            payload_overrides={
                "prompt": base,
                "currentPrompt": base,
                "nsfw": False,
            },
        )
        self.assertNotIn("成年", front_five_sections(result["positivePrompt"]))

    def test_nsfw_false_still_preserves_existing_explicit_adult_identity(self):
        result, _calls = self.run_with_ir(
            sensitive_pair_ir_without_adult_identity(),
            requirements="",
            payload_overrides={"nsfw": False},
        )
        front = front_five_sections(result["positivePrompt"])
        self.assertEqual(
            front.count("25岁以上的成年东方女性角色，东方女性角色"),
            2,
        )

    def test_nsfw_sensitive_words_on_pure_object_do_not_require_adult(self):
        base = "一个红色香水瓶，采用性感成人向产品广告风格。"
        result, _calls = self.run_with_ir(
            sensitive_object_ir(),
            requirements="",
            payload_overrides={"prompt": base, "currentPrompt": base},
        )
        self.assertNotIn("成年", front_five_sections(result["positivePrompt"]))

    def test_inline_chinese_hard_constraints_are_restored_when_missing(self):
        base = "一名25岁成年女性，身穿红色服装。必须保持红色服装，禁止增加帽子。"
        ir = adult_pair_ir(
            applied_requirements=[],
            terminal_constraints=["肢体结构必须正确"],
        )
        ir["subjects"][0]["colors"] = ["红色服装", "白皙肤色"]
        result, _calls = self.run_with_ir(
            ir,
            requirements="",
            payload_overrides={"prompt": base, "currentPrompt": base},
        )
        terminal = result["positivePrompt"].split("[用户附加要求]", 1)[1]
        self.assertIn("必须保持红色服装", terminal)
        self.assertIn("禁止增加帽子", terminal)

    def test_inline_chinese_hard_constraints_accept_semantic_terminal_facts(self):
        base = "一名25岁成年女性，身穿红色服装。必须保持红色服装，禁止增加帽子。"
        ir = adult_pair_ir(
            applied_requirements=[],
            terminal_constraints=["红色服装必须保持不变", "帽子不得出现"],
        )
        ir["subjects"][0]["colors"] = ["红色服装", "白皙肤色"]
        result, _calls = self.run_with_ir(
            ir,
            requirements="",
            payload_overrides={"prompt": base, "currentPrompt": base},
        )
        terminal = result["positivePrompt"].split("[用户附加要求]", 1)[1]
        self.assertIn("红色服装", terminal)
        self.assertIn("帽子不得出现", terminal)

    def test_inline_english_hard_constraints_are_preserved(self):
        base = (
            "One adult woman wears a red dress. "
            "The red dress must remain red. Never add a hat."
        )
        restored_ir = adult_pair_ir(
            applied_requirements=[],
            terminal_constraints=["肢体结构必须正确"],
        )
        restored_ir["subjects"][0]["colors"] = ["red dress", "fair skin"]
        restored, _calls = self.run_with_ir(
            restored_ir,
            requirements="",
            payload_overrides={"prompt": base, "currentPrompt": base},
        )
        restored_terminal = restored["positivePrompt"].split("[用户附加要求]", 1)[1]
        self.assertIn("The red dress must remain red", restored_terminal)
        self.assertIn("Never add a hat", restored_terminal)
        semantic_ir = adult_pair_ir(
            applied_requirements=[],
            terminal_constraints=[
                "The red dress must remain red",
                "Never add a hat",
            ],
        )
        semantic_ir["subjects"][0]["colors"] = ["red dress", "fair skin"]
        result, _calls = self.run_with_ir(
            semantic_ir,
            requirements="",
            payload_overrides={"prompt": base, "currentPrompt": base},
        )
        self.assertIn("Never add a hat", result["positivePrompt"])

    def test_explicit_target_change_can_replace_one_inline_constraint(self):
        base = "一名25岁成年女性，身穿红色服装。必须保持红色服装，禁止增加帽子。"
        ir = adult_pair_ir(
            applied_requirements=["蓝色服装"],
            terminal_constraints=["帽子不得出现"],
        )
        ir["subjects"][0]["colors"] = ["蓝色服装", "白皙肤色"]
        result, _calls = self.run_with_ir(
            ir,
            requirements="用户本次修改要求（最高优先级）：改为蓝色服装",
            payload_overrides={"prompt": base, "currentPrompt": base},
        )
        self.assertIn("蓝色服装", front_five_sections(result["positivePrompt"]))
        self.assertIn("帽子不得出现", result["positivePrompt"])


if __name__ == "__main__":
    unittest.main()
