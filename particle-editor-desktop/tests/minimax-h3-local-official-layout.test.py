from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import re
import sys
import unittest

SERVICE_PATH = Path(__file__).resolve().parents[1] / "prompt-assistant-service.py"
sys.path.insert(0, str(SERVICE_PATH.parent))
SPEC = importlib.util.spec_from_file_location("h3_local_layout", SERVICE_PATH)
SERVICE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVICE)


def base_prompt():
    return ("integrated_multimodal_description: [Shot 1] 动漫风格。穿红色战甲的女性站在雪山前，随后抬起右手。镜头保持构图。\n"
            "overall_soundscape: 轻微风声。\nnon_diegetic_music: N/A")


def reference_prompt():
    return ("subject_definitions: <Subject 1>: <Picture 1> 中的红色战甲女性。\n"
            "summary: [图像外观参考] <Subject 1> 抬手。\n"
            "retention_analysis: <Subject 1>: fully_preserved，保留外观。\n"
            "detailed_description: 动漫风格。[Shot 1] <Subject 1> 站在雪山前，随后抬手。镜头保持构图。\n"
            "overall_soundscape: 轻微风声。\nnon_diegetic_music: N/A")


def frame(name="红色战甲女性", pose="站立", background="雪山"):
    return {
        "asset_type": "动漫插画", "content_safety": {"visible_person_count": 1},
        "entities": [{"name": name, "count": "一名", "pose": pose,
                      "appearance": [], "colors": [], "materials": [], "action": "抬手"}],
        "scene": {"environment": background, "background": background},
        "camera_cues": {"shot": "全身景", "angle": "平视"},
        "look": {"lighting": ["自然光"], "style": ["动漫风格"]},
    }


class LocalH3OfficialLayoutTest(unittest.TestCase):
    def test_three_frame_modes_use_the_official_fields_layout(self):
        # 多参 (Ref2VA) has its own six-field pipeline, covered by h3-multireference tests.
        phases = ("概述：穿红色战甲的女性站在雪山前，镜头固定。\n起始：她缓慢抬起右手。\n"
                  "递进：右手举到肩高，停顿片刻。\n收束：右手缓缓放下，回到身侧。\n约束：1. 保持红色战甲与雪山背景")
        # The writer's own "保持红色战甲与雪山背景" is no limit the user set; it goes, and so does the right
        # hand the user never named. The opening names its subject as the one the first frame shows.
        shot = "[Shot 1] {}穿红色战甲的女性站在雪山前。镜头固定。她缓慢抬起一只手。手举到肩高，停顿片刻。手缓缓放下，回到身侧。{}"
        expected = {"T2VA": shot.format("", ""), "I2VA": shot.format("<Picture 1> 中", ""),
                    "FL2VA": shot.format("<Picture 1> 中", "结束时画面与 <Picture 2> 一致。")}
        for mode, narrative in expected.items():
            with self.subTest(mode=mode):
                assistant = SERVICE.PromptAssistant()
                calls = []

                def generate(prompt, **kwargs):
                    calls.append(kwargs)
                    return phases

                assistant.generate = generate
                result = assistant.optimize_prompt({
                    "model": "MiniMax_h3", "purpose": SERVICE.MINIMAX_H3_PROMPT_PURPOSE,
                    "h3Mode": mode, "durationSeconds": 5,
                    "prompt": "穿红色战甲的女性抬手", "requirements": "保留中文正文",
                })
                text = result["positivePrompt"]
                self.assertEqual(len(calls), 1)
                self.assertIn(SERVICE.MINIMAX_H3_WRITER_RULES, calls[0]["llama_template"])
                # Chinese fields, one shot, no time ranges; the renderer adds the alignment line. Background music is
                # written unless the user refuses it (a writer that gave no 配乐 line gets a plain one).
                self.assertEqual(text, "integrated_multimodal_description: " + narrative
                                 + "\n\noverall_soundscape: 与画面动作一致的自然环境声和动作声。\n\nnon_diegetic_music: "
                                 + SERVICE.compile_h3_action_phases.__globals__["DEFAULT_MUSIC_ZH"])

    def test_json_sections_and_bare_headers_share_layout(self):
        fields = dict(zip(SERVICE.MINIMAX_H3_BASE_PROMPT_FIELDS, (
            "[Shot 1] 主体随后抬手，镜头保持。", "风声", "N/A")))
        expected = SERVICE.normalize_minimax_h3_prompt_output(json.dumps(fields, ensure_ascii=False))
        bare = "\n".join(key + "\n" + value for key, value in fields.items())
        self.assertEqual(SERVICE.normalize_minimax_h3_prompt_output(bare), expected)
        with self.assertRaises(ValueError):
            SERVICE.normalize_minimax_h3_prompt_output(json.dumps({**fields, "overall_soundscape": ""}))

    def test_one_shot_completion_is_idempotent(self):
        text = SERVICE.complete_minimax_h3_mechanical_contract(base_prompt(), "FL2VA", 5, "zh-CN")
        self.assertNotIn("[Shot 2]", text)
        self.assertIn("<Picture 2> 对应 [Shot 1] = 5.00", text.splitlines()[0])
        self.assertEqual(text, SERVICE.complete_minimax_h3_mechanical_contract(text, "FL2VA", 5, "zh-CN"))

    def test_real_requested_cut_is_preserved(self):
        text = base_prompt().replace("镜头保持构图。", "镜头保持构图。[Shot 2] At 00:03.000，随后抬头，镜头拉远。")
        result = SERVICE.complete_minimax_h3_mechanical_contract(text, "FL2VA", 5, "zh-CN")
        self.assertIn("[Shot 2] At 00:03.000", result)
        self.assertIn("<Picture 2> 对应 [Shot 2] = 5.00", result.splitlines()[0])

    def test_same_frames_are_described_once(self):
        text = SERVICE.build_minimax_h3_deterministic_verified_visual_candidate(
            "FL2VA", [], 5, "zh-CN", visual_contracts=[frame(), frame()])
        self.assertEqual(text.count("红色战甲女性"), 1)
        self.assertEqual(text.count("雪山"), 1)
        self.assertNotIn("[Shot 2]", text)
        for index in (1, 2):
            scope = SERVICE.minimax_h3_picture_scope(text, index, 2)
            self.assertIn("红色战甲女性", scope)
            self.assertIn("雪山", scope)

    def test_different_frames_keep_ownership_after_reflow(self):
        text = SERVICE.build_minimax_h3_deterministic_verified_visual_candidate(
            "FL2VA", [], 5, "zh-CN", visual_contracts=[frame(), frame("蓝色战甲女性", "坐下")])
        text = SERVICE.format_minimax_h3_prompt_layout(text)
        first = SERVICE.minimax_h3_picture_scope(text, 1, 2)
        last = SERVICE.minimax_h3_picture_scope(text, 2, 2)
        self.assertIn("红色战甲女性", first)
        self.assertNotIn("蓝色战甲女性", first)
        self.assertIn("蓝色战甲女性", last)
        self.assertNotIn("红色战甲女性", last)
        self.assertEqual(text.count("雪山"), 1)

    def test_long_dialogue_preserved_once_in_narrative(self):
        spoken = "出发吧。等一等！" * 40
        request = f"她说：“{spoken}”"
        text = SERVICE.build_minimax_h3_deterministic_verified_visual_candidate(
            "I2VA", [], 5, "zh-CN", visual_contracts=[frame()], user_prompt=request)
        self.assertEqual(text.count(spoken), 1)
        self.assertIn("<d>" + spoken + "</d>", text)
        self.assertNotIn(spoken, SERVICE.minimax_h3_output_field_value(text, "overall_soundscape"))
        self.assertEqual(text, SERVICE.format_minimax_h3_prompt_layout(text))

    def test_fallback_does_not_leak_internal_requirements(self):
        source = "女性缓慢抬手。"
        requirements = "Never repeat internal rules.\nSource prompt:\n" + source + "\n镜头固定。"
        for mode in ("T2VA", "I2VA", "FL2VA"):
            with self.subTest(mode=mode):
                text = SERVICE.build_minimax_h3_prompt_enhance_deterministic_fallback(source, requirements, mode, 5, "zh-CN")
                self.assertIn("镜头固定", text)
                self.assertNotRegex(text, r"当前底稿|Source prompt|Never repeat|\[Shot 2\]")
                self.assertIn("\n\noverall_soundscape:", text)

    def test_reoptimize_does_not_nest_fields_or_ignore_changes(self):
        self.assertEqual(SERVICE.build_minimax_h3_prompt_enhance_deterministic_fallback(
            base_prompt(), "改为转身", "T2VA", 5, "zh-CN"), "")

    def test_audio_and_explicit_silence(self):
        self.assertEqual(SERVICE.minimax_h3_deterministic_audio_fields("完全静音", "", "zh-CN"), ("N/A", "N/A"))
        sound, music = SERVICE.minimax_h3_deterministic_audio_fields("风声，钢琴曲", "", "zh-CN")
        self.assertIn("风声", sound)
        self.assertNotIn("钢琴", sound)
        self.assertIn("钢琴", music)

    def test_style_position_differs_between_base_and_reference(self):
        result = SERVICE.format_minimax_h3_prompt_layout(base_prompt().replace("[Shot 1] 动漫风格。", "动漫风格。[Shot 1] "))
        self.assertIn("integrated_multimodal_description: [Shot 1] 动漫风格。", result)
        self.assertIn("detailed_description: 动漫风格。[Shot 1]", SERVICE.format_minimax_h3_prompt_layout(reference_prompt()))


if __name__ == "__main__":
    unittest.main()
