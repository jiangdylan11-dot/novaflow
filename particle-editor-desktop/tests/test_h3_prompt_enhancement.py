import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from prompt_assistant.h3_prompt_enhance import validate_enhancement, compile_action_phases, INSTRUCTION

spec = importlib.util.spec_from_file_location("h3_enhance_service", ROOT / "prompt-assistant-service.py")
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)
CASES = json.loads((Path(__file__).parent / "fixtures/h3-prompt-enhance-cases.json").read_text(encoding="utf-8"))


def wrap(text):
    return f"integrated_multimodal_description: [Shot 1] {text}\n\noverall_soundscape: N/A\n\nnon_diegetic_music: N/A"


def five_wrap(text):
    return f"【任务定位】\n文生视频，时长2秒。\n\n【说话者】\n无说话者\n\n【递进式详细提示词】\n0.0-2.0s：{text}\n\n【台词】\n无台词\n\n【连续性与约束】\n1. 保持身份和构图。"


class H3EnhancementTest(unittest.TestCase):
    def test_phase_compiler_owns_time_and_reference_inventory(self):
        phases = "概述：机器人原地站立，以细微呼吸表现待机状态。\n起始：机器人保持站姿，肩部随吸气轻轻抬升。\n递进：呼气时肩部缓慢回落，身体位置保持不变。\n收束：呼吸幅度回到起始状态，平滑衔接下一轮。\n约束：保持机体结构和站位，首尾无缝循环。"
        source = "机器人原地呼吸待机，无缝循环。"
        for mode, inventory in [("T2VA", "(none)"), ("Ref2VA", "<Picture 1> = image; <Audio 1> = audio")]:
            output = compile_action_phases(phases, mode, 3, source, "Available resource labels:" + inventory)
            self.assertIn("0-1s：", output)
            self.assertIn("2-3s：", output)
            self.assertEqual("<Picture 1>" in output, mode == "Ref2VA")
            self.assertEqual("<Audio 1>" in output, mode == "Ref2VA")
        with self.assertRaises(ValueError):
            compile_action_phases("概述："+source+"\n起始："+source+"\n递进："+source+"\n收束："+source+"\n约束：保持身份", "T2VA", 3, source)

    def test_phase_compiler_uses_rewritten_setting_and_keeps_complete_dialogue(self):
        source = '蓝色机器人在夜晚的仓库向前走，镜头固定。\n(S1)："系统已就绪，请下达指令。"'
        requirement = '改为白天原地挥手，镜头缓慢拉近；蓝色外壳和原台词保持。'
        content = '概述：白天的仓库中，蓝色机器人原地站立挥手，镜头缓慢拉近。\n起始：右手抬至肩旁，手掌面向镜头，唇部开始自然说话。\n递进：手掌左右轻摆，躯干保持站位，镜头继续推近。\n收束：手臂缓缓放回身侧，完整说完台词，视线停在镜头。\n约束：保持蓝色外壳和原台词，身体不位移，口型自然。'
        result = compile_action_phases(content, 'T2VA', 6, source, '', requirement)
        self.assertIn('白天的仓库', result)
        self.assertIn('(S1)：“系统已就绪，请下达指令。”', result)
        for old in ['夜晚', '向前走', '镜头固定', '补充要求：']:
            self.assertNotIn(old, result)

    def test_idle_can_sustain_one_phase_without_inventing_more_movement(self):
        phase = '人物原地呼吸，肩部随吸气缓慢抬升、呼气自然回落，其余姿态不变。'
        raw = '概述：银色机器人站在室内，机位固定，以细微呼吸表现待机。\n起始：'+phase+'\n递进：'+phase+'\n收束：'+phase+'\n约束：保持首尾帧身份及构图，只允许呼吸微动。'
        result = compile_action_phases(raw, 'FL2VA', 3, '机器人站在室内。', '', '仅允许呼吸，身体不得位移。')
        self.assertIn('0-3s：'+phase, result)
        self.assertEqual(result.count(phase), 1)
        self.assertIn('<Picture 2>', result)

    def test_missing_visual_fields_are_reobserved_once_and_existing_facts_preserved(self):
        raw='A|S:蓝色机器人|R:右手握工具\nV|E:工厂|L:冷光'
        calls=[]
        def repair(prompt):
            calls.append(prompt)
            return 'L:冷色侧光\nC:中景；平视'
        rich=service.minimax_h3_repair_bounded_visual_slots(raw, repair)
        self.assertEqual(len(calls), 1)
        self.assertIn('C:', calls[0])
        self.assertNotIn('S:', calls[0])
        self.assertIn('右手握工具', rich)
        self.assertIn('中景；平视', rich)
        failed=[]
        with self.assertRaises(service.VisualContractError):
            service.minimax_h3_repair_bounded_visual_slots(raw, lambda prompt: failed.append(prompt) or 'L:冷光')
        self.assertEqual(len(failed), 1)

    def test_visual_slots_follow_labels_not_order_or_line_breaks(self):
        original = "A|S:机器人；蓝色眼睛|R:手握工具\nV|E:工厂|L:数字绘画；冷光|C:中景；正面"
        reordered = "V|C:中景；正面|E:工厂|L:数字绘画；冷光\nA|R:手握工具|S:机器人；蓝色眼睛"
        expected = service.minimax_h3_bounded_visual_slots_to_rich(original)
        self.assertEqual(service.minimax_h3_bounded_visual_slots_to_rich(reordered), expected)
        self.assertEqual(service.minimax_h3_bounded_visual_slots_to_rich(original.replace('|','\n')), expected)
        for broken in [original.replace('|C:中景；正面',''), original.replace('|R:', '|X:')]:
            with self.assertRaises(service.VisualContractError):
                service.minimax_h3_bounded_visual_slots_to_rich(broken)
        # A repeated S is the next subject, never a failure.
        self.assertIn('主体2 = "重复主体"', service.minimax_h3_bounded_visual_slots_to_rich(original+'|S:重复主体'))

    def test_camera_keyword_is_not_required_for_meaningful_action(self):
        assistant = service.PromptAssistant()
        calls = []
        output = five_wrap("角色先缓慢抬起右手至胸前，短暂停留，再放下回到起始姿态，动作连贯且保持身份稳定。")
        def generate(*args, **kwargs):
            calls.append(kwargs)
            return output
        assistant.generate = generate
        result = assistant.optimize_prompt({"purpose":"minimax-h3-prompt-enhance", "h3Mode":"T2VA", "durationSeconds":2, "currentPrompt":"角色抬手再放下。"})
        self.assertEqual(result['positivePrompt'], output)
        self.assertEqual(len(calls), 1)

    def test_shared_cases(self):
        for case in CASES:
            with self.subTest(case["name"]):
                if case["ok"]:
                    self.assertEqual(validate_enhancement(wrap(case["result"]), case["source"], case.get("requirement", "")), wrap(case["result"]))
                else:
                    with self.assertRaises(ValueError):
                        validate_enhancement(wrap(case["result"]), case["source"], case.get("requirement", ""))

    def test_long_source_does_not_truncate_appended_user_requirements(self):
        source = '蓝色机器人站立。' * 1600
        requirement = '镜头缓慢拉近，机器人抬起右手再放下。'
        assistant = service.PromptAssistant()
        def generate(prompt, **kwargs):
            self.assertIn('User requirement:\n' + requirement, prompt)
            return five_wrap(requirement + '手臂先到胸前短暂停留，然后逐步回落到身侧。')
        assistant.generate = generate
        result = assistant.optimize_prompt({'purpose':'minimax-h3-prompt-enhance', 'h3Mode':'T2VA', 'durationSeconds':2, 'currentPrompt':source, 'requirements':'Source prompt:\n'+source+'\n\n'+requirement})
        self.assertIn('抬起右手', result['positivePrompt'])

    def test_uploads_decide_reference_tasks_not_the_model_guess(self):
        from prompt_assistant.h3_prompt_enhance import render_reference_plan, validate_reference
        plan = {"references": [{"label": "<Subject 1>", "sources": ["<Picture 1>"], "description": "来自 <Picture 1> 的角色。", "keep": "面容与发型不变"}],
                "tasks": ["video editing", "reference generation", "audio reuse"], "summary": "角色做往复动作，3秒循环。",
                "description": "<Subject 1> 位于画面中央往复运动，结束时回到起始姿态与运动相位。", "soundscape": "N/A", "music": "N/A"}
        inventory = "Available resource labels: <Picture 1>"
        output = render_reference_plan(json.dumps(plan, ensure_ascii=False), inventory, 3, "往复动作，3秒循环", "")
        self.assertIn("summary:\n[reference generation] ", output)
        self.assertNotIn("<Video", output)
        # The same trimming applies to a finished six-field document.
        guessed = output.replace("[reference generation]", "[video editing + reference generation + audio reference]")
        self.assertIn("summary:\n[reference generation] ", validate_reference(guessed, inventory, 3))
        # With a video uploaded, editing stays available and still needs its source binding.
        with self.assertRaises(ValueError):
            validate_reference(guessed, "Available resource labels: <Picture 1>; <Video 1>", 3)

    def test_structured_copy_and_audio_only_change(self):
        source = wrap("角色随后抬手，镜头固定。")
        with self.assertRaises(ValueError):
            validate_enhancement(source.replace("N/A", "轻微风声", 1), source)

    def test_local_retry_refines_narrative_and_keeps_format(self):
        case = CASES[1]
        outputs = iter([five_wrap(case["source"]), five_wrap(case["result"])])
        assistant = service.PromptAssistant()
        calls = []
        def generate(prompt, **kwargs):
            calls.append((prompt, kwargs))
            return next(outputs)
        assistant.generate = generate
        result = assistant.optimize_prompt({"purpose":"minimax-h3-prompt-enhance", "h3Mode":"T2VA", "durationSeconds":2, "currentPrompt":case["source"]})
        self.assertEqual(len(calls), 2)
        self.assertIn(INSTRUCTION, calls[0][1]["llama_template"])
        self.assertIn(INSTRUCTION, calls[1][1]["llama_template"])
        self.assertIn("回到起始", result["positivePrompt"])
        self.assertIn("【连续性与约束】", result["positivePrompt"])

    def test_local_repeated_copy_fails_without_fabricated_fallback(self):
        source = "角色随后抬起右手，镜头固定。"
        assistant = service.PromptAssistant()
        calls = []
        def generate(*args, **kwargs):
            calls.append(kwargs)
            return five_wrap(source)
        assistant.generate = generate
        with self.assertRaisesRegex(ValueError, "原提示词未修改"):
            assistant.optimize_prompt({"purpose":"minimax-h3-prompt-enhance", "h3Mode":"T2VA", "durationSeconds":2, "currentPrompt":source})
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
