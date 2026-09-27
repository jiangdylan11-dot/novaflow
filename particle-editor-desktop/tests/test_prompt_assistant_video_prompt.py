"""Video prompt features (视频提示优化, WAN 看图写, 首尾帧) and the shared output parsers on Qwen3."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock


SERVICE_PATH = Path(__file__).resolve().parents[1] / "prompt-assistant-service.py"
sys.path.insert(0, str(SERVICE_PATH.parent))
SPEC = importlib.util.spec_from_file_location("novaflow_prompt_assistant_service_video", SERVICE_PATH)
SERVICE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(SERVICE)

PLACEHOLDER = "__NOVAFLOW_RESOURCE_MENTION_1_1__"


class SplitOptimizedOutputTests(unittest.TestCase):
    def test_label_variants(self):
        cases = {
            "正向：剑客拔剑。\n负向：低质量, 模糊": ("剑客拔剑。", "低质量, 模糊"),
            "正向提示词：剑客拔剑。\n负向提示词：低质量, 模糊": ("剑客拔剑。", "低质量, 模糊"),
            "**正向：** 剑客拔剑。\n**负向：** 低质量": ("剑客拔剑。", "低质量"),
            "### 正向提示词\n剑客拔剑。\n### 负向提示词\n低质量": ("剑客拔剑。", "低质量"),
            "正向：剑客拔剑。\n推荐负面提示词：低质量": ("剑客拔剑。", "低质量"),
            "负向：低质量\n正向：剑客拔剑。": ("剑客拔剑。", "低质量"),
        }
        for output, expected in cases.items():
            with self.subTest(output=output):
                self.assertEqual(SERVICE.split_optimized_output(output), expected)

    def test_positive_mentioning_negative_without_colon_and_missing_negative(self):
        self.assertEqual(
            SERVICE.split_optimized_output("剑客拔剑，神情坚定，避免负向情绪。"),
            ("剑客拔剑，神情坚定，避免负向情绪。", ""),
        )
        self.assertEqual(SERVICE.split_optimized_output("正向：剑客拔剑。"), ("剑客拔剑。", ""))


class VideoPromptTidyTests(unittest.TestCase):
    def test_duration_echo_is_dropped_and_sentence_closed(self):
        self.assertEqual(
            SERVICE.tidy_video_prompt("机器人手持洒水壶缓缓前行，镜头平稳后退跟随，动作舒缓自然，全程约5秒"),
            "机器人手持洒水壶缓缓前行，镜头平稳后退跟随，动作舒缓自然。",
        )
        self.assertEqual(
            SERVICE.tidy_video_prompt("机器人倾斜水壶，动作持续约5秒，水流持续2秒后停止，镜头固定。"),
            "机器人倾斜水壶，水流持续2秒后停止，镜头固定。",
        )
        # Only the duration phrase goes when the clause also carries the end state.
        self.assertEqual(
            SERVICE.tidy_video_prompt("蛇怪缓缓向右爬行，镜头向右平移跟随，5秒后停在画面中央，头部微昂。"),
            "蛇怪缓缓向右爬行，镜头向右平移跟随，停在画面中央，头部微昂。",
        )
        # "持续约5秒后停住" goes with its verb instead of leaving "持续停住".
        self.assertEqual(
            SERVICE.tidy_video_prompt("机器人缓慢倾斜水壶，动作匀速，持续约5秒后停住，壶身恢复直立。"),
            "机器人缓慢倾斜水壶，动作匀速，停住，壶身恢复直立。",
        )

    def test_sound_the_user_never_asked_for_is_dropped(self):
        self.assertEqual(
            SERVICE.tidy_video_prompt("骑士向前冲锋，剑刃在空中发出金属锐响，镜头缓慢后退。", "骑士拔出长剑，向前冲锋"),
            "骑士向前冲锋，镜头缓慢后退。",
        )
        self.assertEqual(
            SERVICE.tidy_video_prompt("铠甲铿锵作响。", ""),
            "铠甲铿锵作响。",  # nothing else is left, so the output is kept rather than emptied
        )
        self.assertEqual(
            SERVICE.tidy_video_prompt("小狗张嘴发出欢快的叫声，镜头固定。", "小狗汪汪叫"),
            "小狗张嘴发出欢快的叫声，镜头固定。",
        )

    def test_end_state_after_walking(self):
        self.assertEqual(
            SERVICE.tidy_video_prompt("机器人缓缓向前迈步，最终停在原地，洒水壶仍握在手中。"),
            "机器人缓缓向前迈步，最终停下，洒水壶仍握在手中。",
        )

    def test_frozen_picture_clause_is_dropped(self):
        self.assertEqual(
            SERVICE.tidy_video_prompt("女子静坐在台阶上，周身光点缓缓飘动，画面保持静止，镜头固定。"),
            "女子静坐在台阶上，周身光点缓缓飘动，镜头固定。",
        )
        self.assertEqual(
            SERVICE.tidy_video_prompt("女子静坐在台阶上，裙摆轻动，画面保持静止。"),
            "女子静坐在台阶上，裙摆轻动。",
        )

    def test_user_duration_labels_and_lines(self):
        self.assertEqual(
            SERVICE.tidy_video_prompt("视频 Prompt：女孩在5秒内跑过街角", "女孩5秒内跑过街角"),
            "女孩在5秒内跑过街角。",
        )
        self.assertEqual(
            SERVICE.tidy_video_prompt("**最终视频Prompt：**\n女孩撑伞\n在雨中奔跑\n镜头后退跟随。"),
            "女孩撑伞，在雨中奔跑，镜头后退跟随。",
        )

    def test_final_period_is_kept_for_reverse_outputs(self):
        self.assertEqual(SERVICE.clean_reverse_output("一只猫。"), "一只猫")
        self.assertEqual(SERVICE.clean_reverse_output("一只猫。", keep_final_period=True), "一只猫。")

    def test_resource_placeholders_once(self):
        source = f"{PLACEHOLDER}里的骑士和 __NOVAFLOW_RESOURCE_MENTION_2_2__ 的战马"
        self.assertEqual(
            SERVICE.keep_resource_placeholders_once(
                "骑士和 __NOVAFLOW_RESOURCE_MENTION_2_2__ 的战马冲锋 __NOVAFLOW_RESOURCE_MENTION_2_2__", source
            ),
            f"{PLACEHOLDER}骑士和 __NOVAFLOW_RESOURCE_MENTION_2_2__ 的战马冲锋",
        )
        self.assertEqual(SERVICE.keep_resource_placeholders_once("骑士冲锋", ""), "骑士冲锋")

    def test_ui_design_text_keeps_only_the_picture(self):
        self.assertEqual(
            SERVICE.tidy_ui_design_prompt(
                "整体为古风配色；道具格子排列在中部，所有控件无悬停或点击状态变化，画面仅展示常态布局。"
                "确保在不同分辨率下可读性稳定。"
            ),
            "整体为古风配色；道具格子排列在中部。",
        )
        self.assertEqual(
            SERVICE.tidy_ui_design_prompt(
                "按钮为圆形，背景深灰，按压态带轻微浮起阴影。底部是歌词区域，文字浅灰，滚动时带轻微模糊过渡。"
            ),
            "按钮为圆形，背景深灰。底部是歌词区域，文字浅灰。",
        )
        # What the user asked for stays.
        self.assertEqual(
            SERVICE.tidy_ui_design_prompt("按钮悬停时发出金光。", "按钮悬停时发光"),
            "按钮悬停时发出金光。",
        )
        # A text cut off at the length limit ends on its last whole sentence.
        self.assertEqual(
            SERVICE.tidy_ui_design_prompt("深色背景。顶部是圆形专辑封面，居中悬浮于上方；底部是进度条，颜色#e0"),
            "深色背景。顶部是圆形专辑封面，居中悬浮于上方。",
        )

    def test_echoed_placeholder_rule_is_dropped(self):
        self.assertEqual(
            SERVICE.keep_resource_placeholders_once(
                "背包界面四周是金色边框；道具格子整齐排列在中部；"
                "所有 __NOVAFLOW_ 开头的资源占位符必须原样保留，不得改动或删减。",
                "武侠手游的背包界面",
            ),
            "背包界面四周是金色边框；道具格子整齐排列在中部。",
        )
        self.assertEqual(
            SERVICE.keep_resource_placeholders_once(
                f"{PLACEHOLDER}里的骑士冲锋，资源占位符原样保留，镜头后退。", f"{PLACEHOLDER}里的骑士"
            ),
            f"{PLACEHOLDER}里的骑士冲锋，镜头后退。",
        )
        # A login form's placeholder text is page content, not the rule.
        self.assertEqual(
            SERVICE.keep_resource_placeholders_once("输入框内是灰色占位符文字，按钮在底部。", "登录页"),
            "输入框内是灰色占位符文字，按钮在底部。",
        )


class FirstLastQualityGateTests(unittest.TestCase):
    def test_gate(self):
        self.assertTrue(SERVICE.is_first_last_action_prompt_quality_ok("女孩从站立缓慢转身，镜头保持固定，背景保持不变。"))
        # Not every subject has a body: a flower opening is a valid transition.
        self.assertTrue(SERVICE.is_first_last_action_prompt_quality_ok("花苞逐渐绽放，镜头缓慢推进。"))
        # Frames that barely differ are honestly described as still apart from small motion.
        self.assertTrue(SERVICE.is_first_last_action_prompt_quality_ok(
            "女子静坐在台阶上，仅身旁的光点缓缓飘动，镜头保持固定，背景保持不变。"
        ))
        self.assertFalse(SERVICE.is_first_last_action_prompt_quality_ok("花苞逐渐绽放。"))
        self.assertFalse(SERVICE.is_first_last_action_prompt_quality_ok(
            "主体：女孩\n首帧姿态：站立\n尾帧姿态：缓慢转身\n镜头变化：镜头固定"
        ))


class VideoPromptFeatureTests(unittest.TestCase):
    def test_animation_optimize_asks_for_positive_only_under_its_own_system_turn(self):
        assistant = SERVICE.PromptAssistant()
        calls = []

        def generate(prompt: str, **kwargs):
            calls.append((prompt, kwargs))
            return f"正向：{PLACEHOLDER}里的骑士拔出长剑，向前冲锋，镜头后退跟随，动作持续约5秒"

        assistant.generate = generate
        result = assistant.optimize_prompt({
            "prompt": f"{PLACEHOLDER}里的骑士拔出长剑，向前冲锋",
            "surface": "animation",
            "purpose": "optimize",
            "requirements": "动作要有力量感",
        })
        prompt, kwargs = calls[0]
        system_text, parts = SERVICE.qwen3_chat_parts(prompt, kwargs.get("llama_template"), kwargs.get("images"))
        self.assertIn("视频生成 Prompt 设计助手", system_text)
        self.assertNotEqual(system_text, SERVICE.QWEN3_DEFAULT_SYSTEM_TEXT)
        self.assertNotIn("负向：", parts[0])
        self.assertIn("资源引用占位符", parts[0])
        self.assertIn("动作要有力量感", parts[0])
        self.assertEqual(result["positivePrompt"], f"{PLACEHOLDER}里的骑士拔出长剑，向前冲锋，镜头后退跟随。")
        self.assertTrue(result["negativePrompt"])

    def test_animation_optimize_keeps_every_user_action(self):
        assistant = SERVICE.PromptAssistant()
        calls = []

        def generate(prompt: str, **kwargs):
            calls.append(prompt)
            return "骑士拔出长剑，向前冲锋。他右手握住剑柄，将长剑抽出，镜头缓慢后退。"

        assistant.generate = generate
        payload = {"surface": "animation", "purpose": "optimize"}
        assistant.optimize_prompt({**payload, "prompt": "骑士拔出长剑，向前冲锋"})
        # A short request is copied first, so no action the user wrote gets lost.
        self.assertIn("第一句原样照抄", calls[-1])
        self.assertIn("约60到150字", calls[-1])
        long_prompt = "骑士在黄昏的城堡广场上拔出长剑，" * 6
        assistant.optimize_prompt({**payload, "prompt": long_prompt})
        self.assertIn("原句为骨架", calls[-1])
        self.assertNotIn("约60到150字", calls[-1])

    def test_ui_optimize_names_the_placeholder_rule_only_for_placeholders(self):
        assistant = SERVICE.PromptAssistant()
        calls = []

        def generate(prompt: str, **kwargs):
            calls.append(prompt)
            return "背包界面四周是金色边框；道具格子在中部；所有 __NOVAFLOW_ 开头的资源占位符必须原样保留。"

        assistant.generate = generate
        payload = {"surface": "ui-design", "purpose": "ui-design-generation", "supportsNegativePrompt": True}
        result = assistant.optimize_prompt({**payload, "prompt": "武侠手游的背包界面，金色边框"})
        self.assertNotIn("占位符", calls[-1])
        self.assertEqual(result["positivePrompt"], "背包界面四周是金色边框；道具格子在中部。")
        assistant.optimize_prompt({**payload, "prompt": f"{PLACEHOLDER}风格的背包界面"})
        self.assertIn("资源引用占位符", calls[-1])

    def test_wan_first_frame_reverse_writes_orientation_as_seen(self):
        assistant = SERVICE.PromptAssistant()
        calls = []

        def generate(prompt: str, **kwargs):
            calls.append(prompt)
            return "一只橘猫侧身朝画面右侧趴着，前爪向前伸直，镜头保持固定。"

        assistant.generate = generate
        with mock.patch.object(SERVICE, "data_url_to_tensor", lambda _value: object()):
            assistant.reverse_image_prompt({
                "images": [{"dataUrl": "data:image/png;base64,x", "role": "参考图"}],
                "surface": "animation",
                "currentPrompt": "猫咪伸懒腰",
            })
        # No "正对镜头" example that every answer would copy; limbs by the side of the picture.
        self.assertNotIn("正对镜头", calls[-1])
        self.assertIn("画面左侧的手臂", calls[-1])
        self.assertIn("身体部位运动", calls[-1])

    def test_wan_first_frame_reverse_keeps_final_period_and_uses_its_own_system_turn(self):
        assistant = SERVICE.PromptAssistant()
        calls = []

        def generate(prompt: str, **kwargs):
            calls.append((prompt, kwargs))
            return "一只橘色长毛猫端坐在灰色背景前，缓缓伸展前腿，镜头保持固定，全程约5秒。"

        assistant.generate = generate
        with mock.patch.object(SERVICE, "data_url_to_tensor", lambda _value: object()):
            result = assistant.reverse_image_prompt({
                "images": [{"dataUrl": "data:image/png;base64,x", "role": "参考图", "label": "图1"}],
                "surface": "animation",
                "purpose": "",
                "currentPrompt": "",
            })
        prompt, kwargs = calls[0]
        system_text, parts = SERVICE.qwen3_chat_parts(prompt, kwargs.get("llama_template"), kwargs.get("images"))
        self.assertIn("图生视频 Prompt 设计助手", system_text)
        self.assertIsNotNone(parts[0])  # the picture goes ahead of the text
        self.assertEqual(result["prompt"], "一只橘色长毛猫端坐在灰色背景前，缓缓伸展前腿，镜头保持固定。")

    def test_first_last_pair_sends_both_frames_with_system_turns(self):
        assistant = SERVICE.PromptAssistant()
        calls = []

        def generate(prompt: str, **kwargs):
            calls.append((prompt, kwargs))
            if len(calls) == 1:
                return "主体：女子\n首帧姿态：坐着\n尾帧姿态：坐着\n合理动作过渡：保持相近姿态"
            return "女子保持相近姿态坐在台阶上，仅头部轻微转动，镜头保持固定，背景保持不变。"

        assistant.generate = generate
        with mock.patch.object(SERVICE, "data_url_to_tensor", lambda value: value):
            result = assistant.reverse_image_prompt({
                "images": [
                    {"dataUrl": "first", "role": "first_frame", "label": "首帧"},
                    {"dataUrl": "last", "role": "last_frame", "label": "尾帧"},
                ],
                "surface": "animation",
                "purpose": "",
            })
        self.assertEqual(len(calls), 2)
        # Light and shadow get their own line, so a pair that differs only there is not written as still.
        self.assertIn("光影变化：", calls[0][0])
        self.assertIn("阴影", calls[1][0])
        for prompt, kwargs in calls:
            system_text, parts = SERVICE.qwen3_chat_parts(prompt, kwargs.get("llama_template"), kwargs.get("images"))
            self.assertIn("首尾帧", system_text)
            self.assertEqual([part for part in parts if part in ("first", "last")], ["first", "last"])
        self.assertFalse(result["qualityGateFailed"])
        self.assertTrue(result["prompt"].endswith("。"))

    def test_describe_art_style_passes_its_own_system_text(self):
        captured = {}

        class FakeAdapter:
            def __init__(self, *_args, **_kwargs):
                pass

            def generate(self, prompt, _tensor, **kwargs):
                captured.update(kwargs, prompt=prompt)
                return '"Instruction: Render with loose ink washes that bleed into the paper."'

        assistant = SERVICE.PromptAssistant()
        with mock.patch.object(SERVICE, "Qwen3VLAbliteratedAdapter", FakeAdapter), \
                mock.patch.object(SERVICE, "data_url_to_tensor", lambda _value: object()):
            result = assistant.describe_art_style({"images": [{"dataUrl": "data:image/png;base64,x"}]})
        self.assertEqual(captured["prompt"], SERVICE.ART_STYLE_QUESTION)
        self.assertEqual(captured["system_text"], SERVICE.ART_STYLE_SYSTEM_TEXT)
        self.assertEqual(result["style"], "Render with loose ink washes that bleed into the paper.")

    def test_describe_art_style_question_asks_for_the_medium_first_without_a_medium_example(self):
        question = SERVICE.ART_STYLE_QUESTION
        self.assertIn("Begin with the medium name followed by a colon", question)
        self.assertIn("<medium>: <mark>, <mark>, <mark>.", question)
        self.assertIn("paper, canvas or print", question)
        self.assertIn("the lighting", question)
        self.assertNotIn("ink that bleeds", question)

    def test_describe_art_style_unwraps_json_and_drops_what_is_absent(self):
        replies = iter([
            '{"instruction": "Cel-shaded illustration: flat colour blocks, crisp outlines."}',
            "Photorealistic 3D render: smooth surfaces, clean hard edges, no visible seams or textures, "
            "without grain.",
            "No outlines at all.",
            "ink wash: thick black strokes, bold red washes, gold line loops, paper grain.",
            "cel-shaded illustration: flat colour blocks, uniform shading without gradients or texture.",
        ])

        class FakeAdapter:
            def __init__(self, *_args, **_kwargs):
                pass

            def generate(self, _prompt, _tensor, **_kwargs):
                return next(replies)

        assistant = SERVICE.PromptAssistant()
        with mock.patch.object(SERVICE, "Qwen3VLAbliteratedAdapter", FakeAdapter), \
                mock.patch.object(SERVICE, "data_url_to_tensor", lambda _value: object()):
            styles = [
                assistant.describe_art_style({"images": [{"dataUrl": "data:image/png;base64,x"}]})["style"]
                for _ in range(5)
            ]
        self.assertEqual(styles[0], "Cel-shaded illustration: flat colour blocks, crisp outlines.")
        self.assertEqual(styles[1], "Photorealistic 3D render: smooth surfaces, clean hard edges.")
        # A reply that is nothing but an absent clause is left alone rather than emptied.
        self.assertEqual(styles[2], "No outlines at all.")
        # Colour words in front of a mark would make 万物迁移 recolour the object.
        self.assertEqual(styles[3], "Ink wash: thick strokes, bold washes, line loops, paper grain.")
        self.assertEqual(styles[4], "Cel-shaded illustration: flat colour blocks, uniform shading.")

    def test_describe_art_style_keeps_realistic_surfaces_detailed_and_returns_the_raw_reply(self):
        replies = iter([
            "Photorealistic 3D render: smooth continuous shading, precise straight lines, uniform flat surface texture.",
            "Photograph: fine film grain, flat even surfaces, uniform texture.",
            "Ink-and-watercolour cartoon illustration: dry-brush black outlines, flat pale washes, paper grain.",
        ])

        class FakeAdapter:
            def __init__(self, *_args, **_kwargs):
                pass

            def generate(self, _prompt, _tensor, **_kwargs):
                return next(replies)

        assistant = SERVICE.PromptAssistant()
        events = []
        with mock.patch.object(SERVICE, "Qwen3VLAbliteratedAdapter", FakeAdapter), \
                mock.patch.object(SERVICE, "data_url_to_tensor", lambda _value: object()), \
                mock.patch.object(SERVICE, "log_prompt_assistant_event", lambda event, **fields: events.append((event, fields))):
            results = [
                assistant.describe_art_style({"images": [{"dataUrl": "data:image/png;base64,x"}]})
                for _ in range(3)
            ]
        self.assertEqual(
            results[0]["style"],
            "Photorealistic 3D render: smooth continuous shading, precise straight lines, true-to-life fine surface detail.",
        )
        self.assertEqual(results[1]["style"], "Photograph: fine film grain, true-to-life fine surface detail.")
        # Flat washes are a real mark of a painted picture and stay.
        self.assertEqual(
            results[2]["style"],
            "Ink-and-watercolour cartoon illustration: dry-brush outlines, flat pale washes, paper grain.",
        )
        self.assertEqual(
            results[2]["rawStyle"],
            "Ink-and-watercolour cartoon illustration: dry-brush black outlines, flat pale washes, paper grain.",
        )
        self.assertEqual(events[0][0], "art_style_described")
        self.assertIn("uniform flat surface texture", events[0][1]["rawStyle"])

    def test_describe_art_style_names_cartoon_media_and_marks_not_motifs(self):
        self.assertIn("ink-and-watercolour illustration, cartoon", SERVICE.ART_STYLE_SYSTEM_TEXT)
        self.assertIn("true-to-life fine surface detail", SERVICE.ART_STYLE_QUESTION)
        self.assertIn("never the shapes or motifs drawn in the picture", SERVICE.ART_STYLE_QUESTION)


if __name__ == "__main__":
    unittest.main()
