"""H3 素材反推: labelled visual slots with several subjects never fail on format."""

import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("h3_reverse_multi_subject_service", ROOT / "prompt-assistant-service.py")
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

# Real Qwen3 output (woman + cat frame) that used to fail: slots closed with
# Chinese semicolons instead of pipes.
SEMICOLON_SLOTS = (
    "A|S:紫发女性坐台阶持法杖，赤足，猫在下阶；R:手握法杖触地，猫静坐台阶，花瓣飘落\n"
    "V|E:黄昏神庙阶梯背景；L:CG渲染，暖光高光，主色紫白；C:中景平视，浅景深"
)
TWO_SUBJECT_LINES = (
    "S1:紫发女性角色，白色长裙配金色腰带，赤脚坐台阶\n"
    "S2:橘色长毛猫，坐在下层台阶\n"
    "R:女性手持法杖，猫静坐望向前方\n"
    "E:大理石台阶，远处山峦与建筑\n"
    "L:梦幻风格，暖光与冷蓝对比\n"
    "C:中景，平视，浅景深"
)
ONE_SUBJECT_LINES = (
    "S1:短发少女，橙色衬衫，绿色短裤，背着绿色背包\n"
    "R:站立于公路中央，面向镜头\n"
    "E:乡村公路，两侧草地与远山\n"
    "L:动漫风格，阳光高光，蓝绿主色\n"
    "C:中景，平视视角，浅景深"
)


def candidate(mode, raws):
    contracts = [
        service.minimax_h3_project_faithful_rich_contract(
            service.minimax_h3_bounded_visual_slots_to_rich(raw), index,
        )
        for index, raw in enumerate(raws, start=1)
    ]
    text = service.build_minimax_h3_deterministic_verified_visual_candidate(mode, [], 5, "zh-CN", contracts)
    text = service.validate_minimax_h3_prompt_contract(text, mode, 5)
    return service.validate_minimax_h3_visual_fact_coverage(text, contracts, False, "", require_entity_slots=True)


class BoundedSlotParsingTest(unittest.TestCase):
    def test_semicolon_separated_slots_parse(self):
        rich = service.minimax_h3_bounded_visual_slots_to_rich(SEMICOLON_SLOTS)
        self.assertIn('主体1 = "紫发女性坐台阶持法杖，赤足，猫在下阶"', rich)
        self.assertIn('可见接触关系 = "手握法杖触地，猫静坐台阶，花瓣飘落"', rich)
        self.assertIn('环境与层次 = "黄昏神庙阶梯背景"', rich)
        self.assertIn('镜头与构图 = "中景平视，浅景深"', rich)

    def test_envelope_marker_after_semicolon_is_not_a_fact(self):
        rich = service.minimax_h3_bounded_visual_slots_to_rich(
            "A|S:金色奖杯；R:杯身浮雕星形；V|E:纯色背景；L:金属光泽高光；C:特写斜角；"
        )
        self.assertIn('可见接触关系 = "杯身浮雕星形"', rich)
        self.assertNotIn("；V", rich)

    def test_numbered_and_repeated_subjects_map_to_separate_entities(self):
        numbered = service.minimax_h3_bounded_visual_slots_to_rich(TWO_SUBJECT_LINES)
        repeated = service.minimax_h3_bounded_visual_slots_to_rich(TWO_SUBJECT_LINES.replace("S1:", "S:").replace("S2:", "S:"))
        self.assertEqual(numbered, repeated)
        self.assertIn('主体1 = "紫发女性角色', numbered)
        self.assertIn('主体2 = "橘色长毛猫，坐在下层台阶"', numbered)

    def test_subjects_are_capped_and_extra_or_duplicate_slots_do_not_fail(self):
        raw = (
            TWO_SUBJECT_LINES
            + "\nS3:金色法杖\nS4:红色花瓣\nE:重复环境\nL:重复风格\n说明：以上为可见事实\nX|extra"
        )
        rich = service.minimax_h3_bounded_visual_slots_to_rich(raw)
        self.assertIn('主体3 = "金色法杖"', rich)
        self.assertNotIn("主体4", rich)
        self.assertNotIn("重复", rich)
        self.assertNotIn("说明", rich)
        self.assertNotIn("extra", rich)

    def test_over_long_value_is_trimmed_at_a_phrase_boundary(self):
        long_subject = "，".join(["紫发女性角色", "白色长裙", "金色腰带", "赤脚坐台阶", "右手持金色法杖", "闭眼微笑", "长发垂落肩背", "手腕戴金镯", "颈戴项链", "花瓣落在裙摆"])
        rich = service.minimax_h3_bounded_visual_slots_to_rich(
            TWO_SUBJECT_LINES.replace("S1:紫发女性角色，白色长裙配金色腰带，赤脚坐台阶", "S1:" + long_subject)
        )
        value = rich.split('主体1 = "', 1)[1].split('"', 1)[0]
        self.assertLessEqual(len(value), 2 * service.MINIMAX_H3_BOUNDED_VISUAL_SLOT_LIMITS["S"])
        self.assertTrue(long_subject.startswith(value))
        self.assertFalse(value.endswith("，"))
        self.assertIn(value.rsplit("，", 1)[-1], long_subject.split("，"))

    def test_missing_slot_still_fails_closed(self):
        with self.assertRaises(service.VisualContractError) as raised:
            service.minimax_h3_bounded_visual_slots_to_rich(TWO_SUBJECT_LINES.replace("\nC:中景，平视，浅景深", ""))
        self.assertEqual(raised.exception.code, "h3-bounded-visual-slots-invalid")
        self.assertEqual(raised.exception.diagnostics["slotCount"], 4)

    def test_explicit_no_action_answers_r_without_a_relation_line(self):
        rich = service.minimax_h3_bounded_visual_slots_to_rich(ONE_SUBJECT_LINES.replace("R:站立于公路中央，面向镜头", "R:无"))
        self.assertNotIn("可见接触关系", rich)
        text = candidate("I2VA", [ONE_SUBJECT_LINES.replace("R:站立于公路中央，面向镜头", "R:无")])
        self.assertIn("主体1：", text)
        self.assertNotIn("关系：", text)


class BoundedSlotRepairTest(unittest.TestCase):
    def test_only_the_missing_slot_is_reobserved_when_output_was_complete(self):
        calls = []
        raw = ONE_SUBJECT_LINES.replace("R:站立于公路中央，面向镜头\n", "")

        def repair(prompt):
            calls.append(prompt)
            return "R:站立，双手垂在身侧"

        rich = service.minimax_h3_repair_bounded_visual_slots(raw, repair, truncated=False)
        self.assertEqual(len(calls), 1)
        self.assertIn("\nR:", calls[0])
        for kept in ("S1:", "E:", "L:", "C:"):
            self.assertNotIn(kept, calls[0])
        self.assertIn('可见接触关系 = "站立，双手垂在身侧"', rich)
        self.assertIn('镜头与构图 = "中景，平视视角，浅景深"', rich)

    def test_cut_off_final_slot_is_reobserved_with_the_missing_one(self):
        calls = []
        raw = ONE_SUBJECT_LINES.replace("R:站立于公路中央，面向镜头\n", "").replace("C:中景，平视视角，浅景深", "C:中景，平")

        def repair(prompt):
            calls.append(prompt)
            return "R:站立\nC:中景，平视"

        rich = service.minimax_h3_repair_bounded_visual_slots(raw, repair, truncated=True)
        self.assertIn("\nC:", calls[0])
        self.assertIn('镜头与构图 = "中景，平视"', rich)

    def test_missing_subject_repair_asks_for_numbered_subjects(self):
        calls = []
        raw = TWO_SUBJECT_LINES.split("\nR:", 1)[1]
        raw = "R:" + raw

        def repair(prompt):
            calls.append(prompt)
            return "S1:紫发女性角色\nS2:橘色长毛猫"

        rich = service.minimax_h3_repair_bounded_visual_slots(raw, repair, truncated=False)
        self.assertIn("S1:", calls[0])
        self.assertIn('主体2 = "橘色长毛猫"', rich)


class DeterministicCandidateTest(unittest.TestCase):
    def test_two_subjects_render_as_separate_readable_paragraphs(self):
        text = candidate("I2VA", [TWO_SUBJECT_LINES])
        narrative = service.minimax_h3_output_field_value(text, "integrated_multimodal_description")
        paragraphs = [item.strip() for item in narrative.split("\n\n") if item.strip()]
        self.assertTrue(paragraphs[0].startswith("[Shot 1] 主体1："))
        self.assertTrue(paragraphs[1].startswith("主体2："))
        self.assertTrue(paragraphs[2].startswith("关系："))
        self.assertIn("紫发女性角色", paragraphs[0])
        self.assertIn("橘色长毛猫", paragraphs[1])
        # The shared relation is not attributed to the first subject.
        self.assertNotIn("猫静坐", paragraphs[0])
        self.assertIn("女性手持法杖，猫静坐望向前方", paragraphs[2])
        for leaked in ("可见接触关系", "S1", "S2", "槽位"):
            self.assertNotIn(leaked, text)

    def test_subject_that_mentions_another_keeps_its_own_identity(self):
        raw = TWO_SUBJECT_LINES.replace("S2:橘色长毛猫，坐在下层台阶", "S2:橘色长毛猫，坐台阶下方仰视女性")
        text = candidate("I2VA", [raw])
        self.assertIn("主体2：数量：一只；身份：橘色长毛猫；", text)
        self.assertIn("主体1：数量：一名；身份：紫发女性角色；", text)

    def test_semicolon_output_of_the_old_format_now_succeeds(self):
        text = candidate("I2VA", [SEMICOLON_SLOTS])
        self.assertIn("紫发女性坐台阶持法杖", text)
        self.assertIn("花瓣飘落", text)

    def test_single_subject_keeps_its_shape_without_a_duplicate_relation(self):
        text = candidate("I2VA", [ONE_SUBJECT_LINES])
        narrative = service.minimax_h3_output_field_value(text, "integrated_multimodal_description")
        labels = [
            paragraph.strip().split("：", 1)[0].replace("[Shot 1] ", "")
            for paragraph in narrative.split("\n\n") if paragraph.strip()
        ]
        self.assertEqual(labels[:4], ["主体1", "场景", "画面", "光色材质"])
        self.assertIn("动作：站立于公路中央，面向镜头", narrative)
        self.assertEqual(narrative.count("站立于公路中央"), 1)
        self.assertNotIn("可见接触关系", text)

    def test_first_last_frames_with_two_subjects_keep_both_endpoints(self):
        last = TWO_SUBJECT_LINES.replace("坐在下层台阶", "趴在下层台阶")
        text = candidate("FL2VA", [TWO_SUBJECT_LINES, last])
        self.assertIn("<Picture 1> 首帧：\n主体2：", text)
        self.assertIn("<Picture 2> 尾帧：\n主体2：", text)
        self.assertIn("趴在下层台阶", text)
        self.assertIn("<Picture 1> 与 <Picture 2> 共同：\n主体1：", text)
        # One heading per group, no per-paragraph frame prefixes.
        self.assertNotIn("<Picture 1>:", text)
        self.assertEqual(text.count("<Picture 1> 首帧："), 1)


class ReadableSubjectLineTest(unittest.TestCase):
    def test_subject_line_has_labelled_fields_and_chinese_separators(self):
        raw = ONE_SUBJECT_LINES.replace(
            "S1:短发少女，橙色衬衫，绿色短裤，背着绿色背包",
            "S1:男性武将，金色铠甲，红色披风，金色头冠，手持长枪，呈跃起姿态",
        )
        text = candidate("I2VA", [raw])
        line = next(item for item in text.split("\n\n") if "主体1：" in item)
        self.assertIn("主体1：数量：一名；身份：男性武将；外观：金色铠甲、红色披风、金色头冠、手持长枪；姿态：呈跃起姿态；", line)
        for ascii_separator in ("; ", ", "):
            self.assertNotIn(ascii_separator, text.split("overall_soundscape:")[0])

    def test_measure_word_follows_the_head_noun(self):
        for name, count in (
            ("橘色长毛猫", "一只"), ("手", "一只"), ("折扇", "一把"), ("青蛇", "一条"),
            ("武将", "一名"), ("紫发女性角色", "一名"), ("机器人", "一个"), ("金色奖杯", "一个"),
        ):
            self.assertEqual(service.minimax_h3_default_count(name), count, name)
        text = candidate("I2VA", [
            "S1:手，佩戴金色手镯\nS2:折扇，黑色扇面\nR:手握着折扇\nE:纯灰色背景\nL:柔和光源\nC:特写",
        ])
        self.assertIn("主体1：数量：一只；身份：手", text)
        self.assertIn("主体2：数量：一把；身份：折扇", text)

    def test_a_scene_worded_slightly_fuller_in_one_frame_is_shared_once(self):
        last = TWO_SUBJECT_LINES.replace("远处山峦与建筑", "远处山峦与古典建筑")
        text = candidate("FL2VA", [TWO_SUBJECT_LINES, last])
        self.assertEqual(text.count("场景："), 1)
        self.assertIn("场景：大理石台阶，远处山峦与古典建筑", text)
        changed = TWO_SUBJECT_LINES.replace("大理石台阶", "木质台阶")
        text = candidate("FL2VA", [TWO_SUBJECT_LINES, changed])
        self.assertEqual(text.count("场景："), 2)

    def test_a_subject_that_only_adds_a_particle_is_shared_but_a_new_detail_is_not(self):
        particle = TWO_SUBJECT_LINES.replace("坐在下层台阶", "坐下层台阶")
        text = candidate("FL2VA", [particle, TWO_SUBJECT_LINES])
        self.assertEqual(text.count("主体2："), 1)
        self.assertIn("主体2：数量：一只；身份：橘色长毛猫；姿态：坐在下层台阶。", text)
        detail = TWO_SUBJECT_LINES.replace("坐在下层台阶", "坐在下层台阶，闭眼")
        text = candidate("FL2VA", [TWO_SUBJECT_LINES, detail])
        self.assertEqual(text.count("主体2："), 2)

    def test_first_last_sentences_follow_each_other_without_spaces(self):
        text = candidate("FL2VA", [TWO_SUBJECT_LINES, TWO_SUBJECT_LINES.replace("坐在", "趴在")])
        narrative = service.minimax_h3_output_field_value(text, "integrated_multimodal_description")
        self.assertNotRegex(narrative, r"[。！？] ")
        self.assertIn("镜头保持构图。动作在 5.00 秒连续抵达尾帧状态。", narrative)

    def test_visual_instruction_keeps_gaze_to_what_is_visible(self):
        self.assertIn("不写看向某人或某物", service.minimax_h3_faithful_rich_primary_instruction())


class ReverseServiceTest(unittest.TestCase):
    class Adapter:
        outputs: list = []
        calls: list = []

        def __init__(self, *_args, **_kwargs):
            self.last_generation_diagnostics = {}

        def readiness(self):
            return {"available": True, "code": "ready"}

        def generate(self, prompt, image, **kwargs):
            self.__class__.calls.append((prompt, image, kwargs))
            self.last_generation_diagnostics = {"generationHitTokenLimit": False}
            return self.__class__.outputs.pop(0)

        def unload(self):
            pass

    def setUp(self):
        self.saved = (service.Qwen3VLAbliteratedAdapter, service.data_url_to_tensor, service.log_prompt_assistant_event)
        service.Qwen3VLAbliteratedAdapter = self.Adapter
        service.data_url_to_tensor = lambda value: value
        service.log_prompt_assistant_event = lambda *args, **kwargs: None
        self.Adapter.calls = []

    def tearDown(self):
        service.Qwen3VLAbliteratedAdapter, service.data_url_to_tensor, service.log_prompt_assistant_event = self.saved

    def reverse(self, purpose, images, outputs):
        self.Adapter.outputs = list(outputs)
        assistant = service.PromptAssistant()
        assistant.reset_loaded_clip = lambda: None
        return assistant.reverse_image_prompt({
            "purpose": purpose,
            "surface": "animation",
            "currentPrompt": "Use <Picture 1> as the exact opening frame.",
            "requirements": "duration 5 seconds",
            "userPrompt": "",
            "userRequirements": "",
            "preferredOutputLanguage": "zh-CN",
            "visualSchema": service.MINIMAX_H3_VISUAL_SCHEMA_VERSION,
            "contentPolicy": {"sensitiveVisualAnalysis": True, "allSubjectsConfirmedAdult": False},
            "images": images,
        })

    def test_i2v_reverse_with_two_subjects_succeeds_in_one_call(self):
        result = self.reverse("minimax-h3-i2v-reverse", [{"dataUrl": "first", "role": "first_frame"}], [SEMICOLON_SLOTS])
        self.assertEqual(len(self.Adapter.calls), 1)
        self.assertIn("紫发女性坐台阶持法杖", result["positivePrompt"])

    def test_fl2v_reverse_with_two_subjects_succeeds(self):
        result = self.reverse(
            "minimax-h3-fl2v-reverse",
            [{"dataUrl": "last", "role": "last_frame"}, {"dataUrl": "first", "role": "first_frame"}],
            [TWO_SUBJECT_LINES, TWO_SUBJECT_LINES.replace("坐在下层台阶", "趴在下层台阶")],
        )
        self.assertEqual([call[1] for call in self.Adapter.calls], ["first", "last"])
        self.assertIn("<Picture 2> 尾帧：\n主体2：", result["positivePrompt"])
        self.assertIn("趴在下层台阶", result["positivePrompt"])

    def test_complete_output_without_stop_marker_is_not_reasked(self):
        raw = ONE_SUBJECT_LINES.replace("R:站立于公路中央，面向镜头\n", "")
        result = self.reverse(
            "minimax-h3-i2v-reverse", [{"dataUrl": "first", "role": "first_frame"}], [raw, "R:站立于公路中央"],
        )
        self.assertEqual(len(self.Adapter.calls), 2)
        repair_prompt = self.Adapter.calls[1][0]
        self.assertIn("\nR:", repair_prompt)
        self.assertNotIn("C:", repair_prompt)
        self.assertIn("中景", result["positivePrompt"])


if __name__ == "__main__":
    unittest.main()
