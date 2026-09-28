import importlib.util
import json
from pathlib import Path
import re
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from prompt_assistant.h3_prompt_enhance import (validate_enhancement, compile_action_phases, INSTRUCTION, requested_cut,
                                                validate_base_fields, validate_reference, render_reference_plan)

spec = importlib.util.spec_from_file_location("h3_enhance_service", ROOT / "prompt-assistant-service.py")
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)
CASES = json.loads((Path(__file__).parent / "fixtures/h3-prompt-enhance-cases.json").read_text(encoding="utf-8"))


def wrap(text):
    return f"integrated_multimodal_description: [Shot 1] {text}\n\noverall_soundscape: N/A\n\nnon_diegetic_music: N/A"


def narrative(text):
    return text.split("\n\noverall_soundscape:")[0]


class H3EnhancementTest(unittest.TestCase):
    def test_phase_compiler_owns_shots_and_media_labels(self):
        phases = "概述：机器人原地站立，以细微呼吸表现待机状态。\n起始：机器人保持站姿，肩部随吸气轻轻抬升。\n递进：呼气时肩部缓慢回落，身体位置保持不变。\n收束：呼吸幅度回到起始状态，平滑衔接下一轮。\n约束：保持机体结构和站位，首尾无缝循环。"
        source = "机器人原地呼吸待机，无缝循环。"
        text = compile_action_phases(phases, "T2VA", 3, source, "Available resource labels:(none)")
        self.assertTrue(text.startswith("integrated_multimodal_description: [Shot 1] 机器人原地站立，以细微呼吸表现待机状态。"))
        self.assertNotRegex(text, r"\d+(?:\.\d+)?-\d+(?:\.\d+)?s：|【|<Picture|\[Shot 2\]")
        self.assertTrue(text.endswith("\n\noverall_soundscape: 与画面动作一致的自然环境声和动作声。\n\nnon_diegetic_music: N/A"))
        # A label the model invents is dropped; an image video starts from its picture.
        text = compile_action_phases(phases.replace("机器人保持站姿", "<Picture 2> 中的机器人保持站姿"), "I2VA", 3, source)
        self.assertNotIn("<Picture 2>", text)
        self.assertIn("画面从 <Picture 1> 开始，", text)
        with self.assertRaises(ValueError):
            compile_action_phases("概述："+source+"\n起始："+source+"\n递进："+source+"\n收束："+source+"\n约束：保持身份", "T2VA", 3, source)

    def test_phase_compiler_uses_rewritten_setting_and_keeps_complete_dialogue(self):
        source = '蓝色机器人在夜晚的仓库向前走，镜头固定。\n(S1)："系统已就绪，请下达指令。"'
        requirement = '改为白天原地挥手，镜头缓慢拉近；蓝色外壳和原台词保持。'
        content = '概述：白天的仓库中，蓝色机器人原地站立挥手，镜头缓慢拉近。\n起始：右手抬至肩旁，手掌面向镜头，唇部开始自然说话。\n递进：手掌左右轻摆，躯干保持站位，镜头继续推近。\n收束：手臂缓缓放回身侧，完整说完台词，视线停在镜头。\n约束：保持蓝色外壳和原台词，身体不位移，口型自然。'
        result = compile_action_phases(content, 'T2VA', 6, source, '', requirement)
        self.assertIn('白天的仓库', result)
        # The line follows the moment the robot starts talking, verbatim in <d>.
        self.assertIn('开始自然说话。(S1) 说：<d>[Chinese] 系统已就绪，请下达指令。</d>手掌左右轻摆', result)
        for old in ['夜晚', '向前走', '镜头固定', '补充要求：', '【台词】']:
            self.assertNotIn(old, result)

    def test_idle_can_sustain_one_phase_without_inventing_more_movement(self):
        phase = '人物原地呼吸，肩部随吸气缓慢抬升、呼气自然回落，其余姿态不变。'
        raw = '概述：银色机器人站在室内，机位固定，以细微呼吸表现待机。\n起始：'+phase+'\n递进：'+phase+'\n收束：'+phase+'\n约束：保持首尾帧身份及构图，只允许呼吸微动。'
        result = compile_action_phases(raw, 'FL2VA', 3, '机器人站在室内。', '', '仅允许呼吸，身体不得位移。')
        self.assertIn(phase, result)
        self.assertEqual(result.count(phase), 1)
        self.assertIn('结束时画面与 <Picture 2> 一致。', result)

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
        output = wrap("角色先缓慢抬起右手至胸前，短暂停留，再放下回到起始姿态，动作连贯且保持身份稳定。")
        def generate(*args, **kwargs):
            calls.append(kwargs)
            return output
        assistant.generate = generate
        result = assistant.optimize_prompt({"purpose":"minimax-h3-prompt-enhance", "h3Mode":"T2VA", "durationSeconds":2, "currentPrompt":"角色抬手再放下。"})
        # An answer already in the official fields layout is checked, not rebuilt.
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
            self.assertRegex(prompt, r'补充要求[^\n]*\n' + re.escape(requirement))
            return wrap(requirement + '手臂先到胸前短暂停留，然后逐步回落到身侧。')
        assistant.generate = generate
        result = assistant.optimize_prompt({'purpose':'minimax-h3-prompt-enhance', 'h3Mode':'T2VA', 'durationSeconds':2, 'currentPrompt':source, 'requirements':'Source prompt:\n'+source+'\n\n'+requirement})
        self.assertIn('抬起右手', result['positivePrompt'])

    def test_uploads_decide_reference_tasks_not_the_model_guess(self):
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
        outputs = iter([wrap(case["source"]), wrap(case["result"])])
        assistant = service.PromptAssistant()
        calls = []
        def generate(prompt, **kwargs):
            calls.append((prompt, kwargs))
            return next(outputs)
        assistant.generate = generate
        result = assistant.optimize_prompt({"purpose":"minimax-h3-prompt-enhance", "h3Mode":"T2VA", "durationSeconds":2, "currentPrompt":case["source"]})
        self.assertEqual(len(calls), 2)
        for _, kwargs in calls:
            # The local model gets its own short Chinese instruction, not the shared policy block.
            self.assertIn(service.MINIMAX_H3_WRITER_RULES, kwargs["llama_template"])
            self.assertNotIn(INSTRUCTION, kwargs["llama_template"])
        self.assertIn("回到起始", result["positivePrompt"])
        self.assertTrue(result["positivePrompt"].startswith("integrated_multimodal_description: [Shot 1] "))

    def test_local_repeated_copy_fails_without_fabricated_fallback(self):
        source = "角色随后抬起右手，镜头固定。"
        assistant = service.PromptAssistant()
        calls = []
        def generate(*args, **kwargs):
            calls.append(kwargs)
            return wrap(source)
        assistant.generate = generate
        with self.assertRaisesRegex(ValueError, "原提示词未修改"):
            assistant.optimize_prompt({"purpose":"minimax-h3-prompt-enhance", "h3Mode":"T2VA", "durationSeconds":2, "currentPrompt":source})
        self.assertEqual(len(calls), 2)

    def test_base_fields_are_checked_and_made_canonical(self):
        text = ("对齐说明\nintegrated_multimodal_description: 写实电影风格。[Shot 1] <Picture 1> 中的女孩抬手。\n她说：<d>出发吧。</d>"
                "[Shot 2] 镜头切到近景。\n\noverall_soundscape: 风声\n\nnon_diegetic_music: 无")
        # The alignment line goes, the style moves behind [Shot 1], a later shot without a time is spaced evenly.
        self.assertEqual(validate_base_fields(text, "image_video", 6, "zh"),
                         "integrated_multimodal_description: [Shot 1] 写实电影风格。 <Picture 1> 中的女孩抬手。她说：<d>[Chinese] 出发吧。</d>\n"
                         "[Shot 2] At 00:03.000 镜头切到近景。\n\noverall_soundscape: 风声\n\nnon_diegetic_music: N/A")
        json_form = json.dumps({"integrated_multimodal_description": "[Shot 1] A girl in <Picture 1> raises her hand.",
                                "overall_soundscape": "Wind.", "non_diegetic_music": ""})
        self.assertTrue(validate_base_fields(json_form, "I2VA", 5, "en").endswith("non_diegetic_music: N/A"))
        for broken, mode, language in [
                (text.replace("<Picture 1> 中的", ""), "I2VA", None),                        # I2V must name its picture
                (text, "text_video", None),                                                   # T2V has no pictures
                (text.replace("<Picture 1>", "<Picture 1> <Picture 2>"), "first_last", None),  # FL2V needs both, fine here
                (text.replace("[Shot 2]", "[Shot 3]"), "I2VA", None),                         # numbering
                (text.replace("[Shot 2]", "[Shot 2] At 00:07.000"), "I2VA", None),            # past the duration
                (text.replace("女孩", "<Subject 1>"), "I2VA", None),                          # no subject labels
                (text, "I2VA", "en"),                                                         # Chinese prose left
                (text.replace("overall_soundscape: 风声\n\n", ""), "I2VA", None)]:
            with self.subTest(broken=broken[40:90], mode=mode):
                if mode == "first_last":
                    validate_base_fields(broken, mode, 6)
                    continue
                with self.assertRaises(ValueError):
                    validate_base_fields(broken, mode, 6, language)
        english = "integrated_multimodal_description: [Shot 1] Picture 1 opens; the girl says: <d>[Chinese] 出发吧。</d> A sign reads \"营业中\". She stops as in Picture 2.\n\noverall_soundscape: Wind.\n\nnon_diegetic_music: N/A"
        self.assertEqual(validate_base_fields(english, "FL2VA", 5, "en"), english)
        with self.assertRaises(ValueError):
            validate_base_fields(english.replace("Wind.", "The wind blows over the grass and leaves." * 3), "FL2VA", 5, "zh")

    def test_cut_is_detected_only_from_the_users_words(self):
        for asked in ["第3秒切到近景", "镜头切换到她的脸部特写", "分三个镜头", "第二个镜头换到海边", "转场到夜晚", "then cut to the kitchen",
                      "integrated_multimodal_description: [Shot 1] 猫。\n[Shot 2] At 00:02.000 镜头切到近景。"]:
            self.assertTrue(requested_cut(asked), asked)
        for plain in ["一只猫跳下窗台，镜头跟随", "厨师把胡萝卜切成丁", "不要切镜，一镜到底", "镜头固定：全程不推拉、不摇移"]:
            self.assertFalse(requested_cut(plain), plain)

    def test_reference_shots_are_numbered_in_order_inside_the_clip(self):
        base = ("subject_definitions:\n<Subject 1>：来自 <Picture 1> 的猫。\n\nsummary:\n[reference generation] 猫跳下。\n\n"
                "retention_analysis:\n<Subject 1>: fully_preserved - 橘色长毛\n\ndetailed_description:\n{}\n\noverall_soundscape:\nN/A\n\nnon_diegetic_music:\nN/A")
        inventory = "Available resource labels: <Picture 1>"
        good = base.format("[Shot 1] <Subject 1> 跳下桌子。\n[Shot 2] At 00:02.000 镜头切到近景，<Subject 1> 回头。")
        self.assertIn("[Shot 2] At 00:02.000", validate_reference(good, inventory, 5))
        self.assertIn("[Shot 2] At 00:02.500", validate_reference(good.replace(" At 00:02.000", ""), inventory, 5))
        for broken in [good.replace("[Shot 2]", "[Shot 3]"), good.replace("00:02.000", "00:06.000"),
                       base.format("[Shot 1] <Subject 1> 跳下。[Shot 3] At 00:04.000 近景。[Shot 2] At 00:01.000 远景。")]:
            with self.assertRaises(ValueError):
                validate_reference(broken, inventory, 5)
        # A plan's own later shot stays only when the user asked for a cut.
        plan = {"references": [{"label": "<Subject 1>", "sources": ["<Picture 1>"], "description": "橘猫", "keep": "橘色长毛"}],
                "tasks": ["reference generation"], "summary": "<Subject 1> 跳下桌子。",
                "description": "<Subject 1> 跳下桌子，镜头跟随。[Shot 2] At 00:03.000 镜头切到近景，<Subject 1> 回头。", "soundscape": "N/A", "music": "N/A"}
        single = render_reference_plan(json.dumps(plan, ensure_ascii=False), inventory, 5, "猫跳下桌子")
        self.assertNotIn("[Shot 2]", single)
        self.assertIn("镜头切到近景", single)
        self.assertIn("\n[Shot 2] At 00:03.000 镜头切到近景",
                      render_reference_plan(json.dumps(plan, ensure_ascii=False).replace("[Shot 2]", "\\n[Shot 2]"), inventory, 5, "猫跳下桌子，第3秒切到近景"))


PHASES = ["橘猫趴在洒满阳光的窗台上，镜头从侧面跟随。", "橘猫前爪向前伸直，背部下压，缓慢伸懒腰。",
          "后腿蹬起，身体前倾，从窗台一跃而下。", "四爪落地，尾巴轻摆，站稳后抬头。", "1. 保持橘猫外观一致\n2. 动作连贯"]
CAT = "一只橘猫在窗台上伸懒腰，然后跳下窗台"
CAT_TEXT = ("integrated_multimodal_description: [Shot 1] 橘猫趴在洒满阳光的窗台上，镜头从侧面跟随。橘猫前爪向前伸直，背部下压，缓慢伸懒腰。"
            "后腿蹬起，身体前倾，从窗台一跃而下。四爪落地，尾巴轻摆，站稳后抬头。\n\n"
            "overall_soundscape: 与画面动作一致的自然环境声和动作声。\n\nnon_diegetic_music: N/A")


def phases(labels=("概述", "起始", "递进", "收束", "约束"), form="{label}：{text}", joiner="\n"):
    return joiner.join(form.format(label=label, text=text) for label, text in zip(labels, PHASES))


class H3BaseLocalTest(unittest.TestCase):
    def run_local(self, outputs, payload):
        assistant = service.PromptAssistant()
        calls = []
        answers = iter(outputs)

        def generate(prompt, **kwargs):
            calls.append((prompt, kwargs))
            return next(answers)
        assistant.generate = generate
        base = {"purpose": "minimax-h3-prompt-enhance", "durationSeconds": 5, "h3Mode": "text_video", "currentPrompt": CAT}
        return assistant.optimize_prompt({**base, **payload}), calls

    def test_label_spellings_and_garbage_characters_are_normalized(self):
        expected = compile_action_phases(phases(), "T2VA", 5, CAT)
        # One continuous shot; the generic "外观一致/动作连贯" constraints are not visible content.
        self.assertEqual(expected, CAT_TEXT)
        variants = [
            phases(form="【{label}】{text}"), phases(form="**{label}**：{text}"), phases(form="**{label}：**{text}"),
            phases(form="{label}\n{text}"), phases(form="### {label}\n{text}"), "好的，以下是优化后的提示词：\n" + phases(),
            phases(joiner=" ").replace("\n", " "), phases().replace("起始：", "起始（0-1.7秒）：").replace("1. 保持", "1. " + chr(0xFFFD) + "保持"),
        ]
        for variant in variants:
            with self.subTest(variant=variant[:24]):
                self.assertEqual(compile_action_phases(variant, "T2VA", 5, CAT), expected)
        # A missing 约束 label: the numbered list after the last phase is the constraints.
        self.assertEqual(compile_action_phases(phases().replace("约束：", "\n"), "T2VA", 5, CAT), expected)
        numbered = phases().replace("约束：1. 保持橘猫外观一致\n2. 动作连贯", "约束1：保持橘猫外观一致\n约束2：动作连贯")
        self.assertEqual(compile_action_phases(numbered, "T2VA", 5, CAT), expected)
        kept = phases().replace("约束：1. 保持橘猫外观一致\n2. 动作连贯", "保持项1：保持橘猫外观一致\n保持项2：动作连贯")
        self.assertEqual(compile_action_phases(kept, "T2VA", 5, CAT), expected)
        with self.assertRaises(ValueError):
            compile_action_phases(phases().replace("递进：", ""), "T2VA", 5, CAT)

    def test_constraint_freezing_the_pose_is_dropped_unless_asked(self):
        answer = phases().replace("1. 保持橘猫外观一致", "1. 动作从图中姿态自然开始，不改变初始姿态\n3. 姿态和背景保持不变")
        text = compile_action_phases(answer, "T2VA", 5, CAT)
        # The pose leaves "姿态和背景保持不变"; the background item stays, as a sentence after the opening.
        self.assertIn("镜头从侧面跟随。动作从图中姿态自然开始。背景保持不变。橘猫前爪", text)
        self.assertNotIn("不改变初始姿态", text)
        self.assertIn("不改变初始姿态", compile_action_phases(answer, "T2VA", 5, "橘猫蹲坐在窗台上，保持静止"))

    def test_first_last_frame_video_ends_on_its_last_frame_not_a_loop(self):
        answer = ("概述：女神在台阶上静坐，镜头固定。\n起始：权杖上的光点缓缓飘起。\n递进：光点绕着权杖慢慢旋转。\n"
                  "收束：光点落定，画面与 < Picture 2 > 一致。\n约束：1. 外观与背景和两张图一致")
        result, _ = self.run_local([answer], {"h3Mode": "first_last", "currentPrompt": "从首帧无缝过渡到尾帧"})
        self.assertIn("画面与 <Picture 2> 一致。", result["positivePrompt"])
        self.assertIn("画面从 <Picture 1> 开始，", result["positivePrompt"])
        # A requested loop in text-to-video still has to close.
        with self.assertRaisesRegex(ValueError, "循环"):
            self.run_local([phases(), phases()], {"currentPrompt": CAT + "，无缝循环"})

    def test_rules_are_sent_only_when_the_user_asks(self):
        _, calls = self.run_local([phases()], {})
        prompt, kwargs = calls[0]
        for leaked in ["胸肩", "呼吸", "绿", "循环", "无缝", "下一轮", "User requirement", "补充要求", "I2VA", "T2VA", "镜头2", "秒）"]:
            self.assertNotIn(leaked, prompt + kwargs["llama_template"])
        self.assertIn("任务：文生视频，时长5秒。", prompt)
        self.assertIn("\n起始：动作怎样开始", prompt)
        idle = "一位女战士站立，角色仅呼吸待机，绿幕背景，无缝循环，镜头固定"
        prompt = service.build_minimax_h3_writer_request(idle, "", "T2VA", 3)
        for asked in ["仅呼吸待机：", "纯色背景：", "循环：", "镜头固定："]:
            self.assertIn(asked, prompt)
        self.assertNotIn("保持静止：", prompt)
        self.assertIn("收束：动作怎样平滑回到起始姿态", prompt)

    def test_copied_rule_text_is_asked_once_then_dropped(self):
        leaky = phases().replace("镜头从侧面跟随。", "背景为纯绿色幕布，镜头从侧面跟随。").replace(
            "站稳后抬头。", "站稳后抬头，准备进入下一轮循环。") + "\n3. 仅呼吸待机，胸肩随呼吸起伏"
        result, calls = self.run_local([leaky, leaky], {})
        self.assertEqual(len(calls), 2)
        self.assertIn("写入了用户没有要求的", calls[1][0])
        text = result["positivePrompt"]
        for leaked in ["绿", "下一轮", "循环", "胸肩", "仅呼吸"]:
            self.assertNotIn(leaked, text)
        self.assertIn("从窗台一跃而下", text)
        self.assertIn("站稳后抬头。", text)
        # A broken retry still returns the first answer without the copied rule text.
        result, calls = self.run_local([leaky, "无法完成"], {})
        self.assertEqual(len(calls), 2)
        self.assertNotIn("绿", result["positivePrompt"])
        self.assertIn("伸懒腰", result["positivePrompt"])
        # When the user asked for it, the same text is kept.
        asked = CAT + "，绿幕背景"
        result, calls = self.run_local([leaky.replace("准备进入下一轮循环", "停在原地").replace("\n3. 仅呼吸待机，胸肩随呼吸起伏", "")], {"currentPrompt": asked})
        self.assertEqual(len(calls), 1)
        self.assertIn("纯绿色幕布", result["positivePrompt"])

    def test_answer_loses_invented_bans_meta_text_and_undone_results(self):
        answer = ("概述：巨蛇在灰色背景中缓缓抬头，镜头固定。\n起始：巨蛇头部缓慢向上抬起。\n递进：头部继续抬升，信子从口中探出，发出嘶嘶声。\n"
                  "收束：信子收回，巨蛇头部回落至初始姿态，镜头定格于巨蛇头部。\n"
                  "约束：1. 主体姿态、外观和背景须与图一致\n2. 按三阶段完成抬头动作，不脱离原提示词的核心逻辑\n3. 镜头全程固定，不添加台词、音乐或特效")
        text = compile_action_phases(answer, "I2VA", 8, "巨蛇缓缓抬头，吐出信子")
        # Constant facts join the opening; the repeated camera goes, the shot ends on its ending.
        self.assertIn("巨蛇在灰色背景中缓缓抬头，镜头固定。画面从 <Picture 1> 开始，巨蛇头部缓慢向上抬起。头部继续抬升，信子从口中探出。信子收回，镜头停在巨蛇头部。\n\n", text)
        for gone in ["初始姿态", "定格", "三阶段", "原提示词", "音乐", "嘶嘶声", "外观和背景须与图一致", "镜头全程固定"]:
            self.assertNotIn(gone, text)
        self.assertIn("发出嘶嘶声", compile_action_phases(answer, "I2VA", 8, "巨蛇缓缓抬头，发出嘶嘶声"))
        # The user's own return, loop or ban is kept.
        self.assertIn("回落至初始姿态", compile_action_phases(answer, "I2VA", 8, "巨蛇抬头，再回到原来的位置"))
        self.assertIn("音乐", compile_action_phases(answer, "I2VA", 8, "巨蛇缓缓抬头，不要音乐"))

    def test_one_camera_move_and_no_invented_lighting_without_a_picture(self):
        answer = ("概述：厨师在厨房颠锅炒菜，镜头跟随锅身，暖色调灯光下火光交织。\n起始：厨师手臂下压，锅身前倾。\n"
                  "递进：厨师手腕上抖，食材翻起，镜头推近捕捉火光。\n收束：锅落回灶台，镜头拉远展现厨房。\n"
                  "约束：1. 场景始终为厨房，光线保持明亮\n2. 镜头全程跟随，不使用俯拍或仰拍\n3. 不得添加其他人物或道具")
        text = compile_action_phases(answer, "T2VA", 5, "厨师在厨房里颠锅炒菜，锅里火焰窜起")
        self.assertIn("[Shot 1] 厨师在厨房颠锅炒菜，镜头跟随锅身。场景始终为厨房。厨师手臂下压，锅身前倾。厨师手腕上抖，食材翻起。锅落回灶台。\n", text)
        asked = compile_action_phases(answer, "T2VA", 5, "厨师在厨房里颠锅炒菜，暖色调灯光，镜头先跟随再拉远，不得添加其他人物")
        for kept in ["暖色调灯光", "镜头拉远展现厨房", "不得添加其他人物或道具"]:
            self.assertIn(kept, asked)
        self.assertNotIn("镜头推近", asked)

    def test_constraints_keep_only_what_stays_the_same(self):
        answer = phases().replace("1. 保持橘猫外观一致\n2. 动作连贯", (
            "1. 主体始终为橘猫\n2. 动作必须按“伸懒腰→跳下”顺序展开\n3. 风声必须在起始阶段开始，递进阶段增强\n"
            "4. 动作节奏从“缓慢”转“加速”再“收束”\n5. 镜头全程为“跟随”或“平移”，不切换角度或推拉\n"
            "6. 动作从轻旋到高甩再到稳落，节奏递进明确\n7. 金色光粒飘动与舒缓要求同步\n8. 动作全程缓慢，无跳跃或快速变化\n"
            "9. 橘猫动作必须包含伸展、跳跃，尾巴始终可见"))
        text = compile_action_phases(answer, "T2VA", 5, CAT)
        self.assertIn("镜头从侧面跟随。主体始终为橘猫。动作全程缓慢。尾巴始终可见。橘猫前爪", text)
        self.assertNotIn("镜头全程跟随", text)
        # The user's own camera ban stays; the either-or move falls to the user's fixed camera.
        fixed = compile_action_phases(answer.replace("镜头从侧面跟随", "镜头固定"), "T2VA", 5, CAT + "，镜头固定，不要推拉")
        self.assertIn("不切换角度或推拉", fixed)
        self.assertNotIn("跟随", fixed)
        # A camera the overview already names goes together with its bans (they would forbid a requested cut).
        repeated = compile_action_phases(phases().replace("镜头从侧面跟随", "镜头固定").replace("2. 动作连贯", "2. 镜头全程固定，无移动或切换"), "T2VA", 5, CAT)
        self.assertNotRegex(repeated, "无移动|全程固定")

    def test_light_effects_come_from_the_user(self):
        answer = ("概述：二郎神持刀向前劈砍，镜头跟随。\n起始：二郎神右手举刀。\n递进：右臂向前挥出，刀锋划出一道金色刀光，披风翻飞。\n"
                  "收束：刀停在身前，刀身光晕渐次明灭。\n约束：1. 主体始终是二郎神")
        text = compile_action_phases(answer, "I2VA", 5, "二郎神举刀向前劈砍")
        self.assertIn("右臂向前挥出，披风翻飞。刀停在身前。", text)
        self.assertIn("金色刀光", compile_action_phases(answer, "I2VA", 5, "二郎神举刀向前劈砍，刀身发出金光"))
        # Two differing first/last frames may really change their light; nearly identical ones keep theirs.
        self.assertIn("光晕", compile_action_phases(answer, "FL2VA", 5, "从首帧过渡到尾帧"))
        self.assertNotIn("光晕", compile_action_phases(answer, "FL2VA", 5, "从首帧过渡到尾帧", keep_pose=True))

    def test_dialogue_mouth_becomes_plain_speaking(self):
        source = '小机器人给花浇水，抬头对镜头说话\n(S1)："今天的花开得真好。"'
        answer = ("概述：小机器人在花园里给花浇水，镜头固定。\n起始：小机器人右手持洒水壶，壶嘴朝向花坛，壶身倾斜，水流落下。\n"
                  "递进：小机器人抬头面向镜头，嘴巴微张开始说话。\n收束：他口型随台词开合，水流渐停。\n约束：1. 主体始终是小机器人")
        text = compile_action_phases(answer, "I2VA", 5, source)
        self.assertIn("壶嘴朝向花坛", text)
        self.assertIn("小机器人抬头面向镜头，开始说话。(S1) 说：<d>[Chinese] 今天的花开得真好。</d>他说完这句话，水流渐停。", text)
        self.assertNotIn("<Subject", text)
        self.assertIn("嘴巴微张", compile_action_phases(answer, "I2VA", 5, "小机器人给花浇水，抬头张嘴"))
        # "说完" alone: the line comes before it. The official <d> form in the source is read the same way.
        official = compile_action_phases(answer.replace("嘴巴微张开始说话", "看向镜头"), "I2VA", 5,
                                         service.h3_base_source_view("integrated_multimodal_description: [Shot 1] 小机器人给花浇水，抬头对镜头说话，(S1) 说：<d>[Chinese] 今天的花开得真好。</d>\n\noverall_soundscape: 水声\n\nnon_diegetic_music: N/A"))
        self.assertIn("(S1) 说：<d>[Chinese] 今天的花开得真好。</d>他说完这句话", official)

    def test_endings_stay_on_the_result_and_effects_slow_down(self):
        answer = ("概述：金色奖杯在灰色背景前缓慢旋转，镜头固定。\n起始：奖杯从图中姿态开始顺时针缓慢旋转。\n递进：奖杯持续旋转，灯光扫过表面。\n"
                  "收束：奖杯旋转至图中姿态，灯光移到右侧，奖杯静止。\n约束：1. 主体和场景前后保持一致")
        text = compile_action_phases(answer, "I2VA", 5, "奖杯缓缓旋转，灯光扫过表面")
        self.assertIn("灯光扫过表面。灯光移到右侧，奖杯静止。", text)
        self.assertIn("奖杯从图中姿态开始", text)
        text = compile_action_phases(answer.replace("旋转至图中姿态", "旋转至图中初始倾斜角度"), "I2VA", 5, "奖杯缓缓旋转，灯光扫过表面")
        self.assertIn("灯光扫过表面。灯光移到右侧，奖杯静止。", text)
        # "锅里火焰窜起" does not end with the fire going out, unless the user says so.
        chef = ("概述：厨师在厨房里颠锅炒菜，镜头固定。\n起始：厨师双手握锅柄向上提锅。\n递进：食材在锅里翻起，火焰随锅势窜起。\n"
                "收束：锅落回灶台，火焰瞬间熄灭，厨师手仍握锅柄。\n约束：1. 场景始终为厨房")
        self.assertIn("火焰随锅势窜起。锅落回灶台，厨师手仍握锅柄。", compile_action_phases(chef, "T2VA", 5, "厨师在厨房里颠锅炒菜，锅里火焰窜起"))
        self.assertIn("火焰瞬间熄灭", compile_action_phases(chef, "T2VA", 5, "厨师颠锅，锅里火焰窜起后熄灭"))
        # A roar the user never asked for is an invented sound; a quoted line keeps its own full stop.
        answer = ("概述：钟馗持剑怒视前方，镜头固定。\n起始：钟馗身体前倾。\n递进：钟馗怒吼发力，剑身向上挑起。\n"
                  "收束：钟馗说出“收！”\n约束：1. 背景始终为纯白")
        text = compile_action_phases(answer, "I2VA", 5, "钟馗拔剑怒视前方")
        self.assertIn("镜头固定。背景始终为纯白。画面从 <Picture 1> 开始，钟馗身体前倾。剑身向上挑起。钟馗说出“收！”\n\n", text)
        answer = ("概述：女神静坐台阶手持权杖，固定镜头。\n起始：女神轻转权杖，金色光粒飘动。\n递进：权杖继续转动，光粒轻轻飘动。\n"
                  "收束：权杖转回原位，光粒飘落定格，画面复刻<Picture 2>。\n约束：1. 主体位置全程不变")
        text = compile_action_phases(answer, "FL2VA", 6, "女神轻轻转动权杖", "", "金色光粒轻轻飘动", keep_pose=True)
        self.assertIn("权杖转回原位，光粒飘落渐渐放缓，画面与 <Picture 2> 一致。", text)
        text = compile_action_phases(answer.replace("画面复刻<Picture 2>", "画面回归至与< Picture 2>完全一致的静止状态"), "FL2VA", 6, "女神轻轻转动权杖")
        self.assertIn("画面与 <Picture 2> 一致。", text)
        text = compile_action_phases(answer.replace("光粒飘落定格", "镜头定格于权杖"), "FL2VA", 6, "女神轻轻转动权杖", "", "金色光粒轻轻飘动")
        self.assertIn("镜头停在权杖", text)

    def test_request_asks_for_the_real_action_without_a_default_amplitude(self):
        prompt = service.build_minimax_h3_writer_request("她转身向镜头挥手", "", "I2VA", 5, sees_frames=True)
        self.assertIn("\n起始：动作怎样开始，朝哪个方向\n", prompt)
        self.assertIn("\n递进：动作怎样继续发展、真正做出来，节奏怎样变化", prompt)
        self.assertIn("最后停在动作完成后的样子，图中拿着的东西继续拿着", prompt)
        self.assertIn("先用几个字写图中的画风", prompt)
        self.assertNotRegex(prompt, r"\d(?:\.\d)?-\d(?:\.\d)?秒|幅度多大")
        self.assertNotIn("幅度多大", service.MINIMAX_H3_WRITER_RULES)
        kite = service.build_minimax_h3_writer_request("一个小男孩在草地上放风筝", "镜头缓慢推近，加上风声", "T2VA", 5)
        self.assertIn("最后停在动作完成后的样子，描述里拿着的东西继续拿着", kite)
        self.assertNotIn("要求", kite.split("约束：")[1])
        self.assertIn("用视频描述里的原词写主体、场景和动作", kite)
        self.assertIn("没写就写写实电影风格", kite)
        self.assertNotIn("真正做出来", service.build_minimax_h3_writer_request("女战士站立，仅呼吸待机", "", "T2VA", 3))
        # A picture the model cannot see gets no style guess.
        self.assertNotIn("画风", service.build_minimax_h3_writer_request("她转身向镜头挥手", "", "I2VA", 5))

    def test_breathing_idle_keeps_breathing_to_the_end(self):
        answer = ("概述：女战士站在绿幕前呼吸待机，镜头固定。\n起始：胸肩随吸气微微抬起。\n递进：胸肩随呼气缓缓回落。\n"
                  "收束：胸肩再次微微抬起，呼吸节奏归于静止。\n约束：1. 头部和手臂不动")
        text = compile_action_phases(answer, "T2VA", 3, "女战士站立，仅呼吸待机，绿幕背景")
        self.assertIn("镜头固定。头部和手臂不动。胸肩随吸气微微抬起。胸肩随呼气缓缓回落。胸肩再次微微抬起。\n\n", text)
        self.assertNotIn("归于静止", text)
        text = compile_action_phases(answer.replace("呼吸节奏归于静止", "胸肩起伏回落至静止"), "T2VA", 3, "女战士站立，仅呼吸待机，绿幕背景")
        self.assertIn("胸肩再次微微抬起。", text)
        self.assertNotIn("回落至静止", text)
        self.assertIn("收束：呼吸继续平稳起伏", service.build_minimax_h3_writer_request("女战士站立，仅呼吸待机", "", "T2VA", 3))

    def test_speaker_and_request_describe_the_user_actions(self):
        source = '小机器人给花浇水，抬头对镜头说话\n(S1)："今天的花开得真好。"'
        text = compile_action_phases(phases(), "I2VA", 5, source)
        # Nobody talks in this answer: the line still reaches the shot, after its last beat.
        self.assertIn("站稳后抬头。(S1) 说：<d>[Chinese] 今天的花开得真好。</d>", text)
        prompt = service.build_minimax_h3_writer_request(source, "", "I2VA", 5, sees_frames=True, dialogue_lines=['(S1)："今天的花开得真好。"'])
        self.assertIn("- 小机器人给花浇水\n- 抬头对镜头说话\n", prompt)
        self.assertIn("只写说话，不写嘴和口型", prompt)
        self.assertNotIn("灯光", prompt)
        self.assertIn("写清它从画面哪里出现", prompt)
        self.assertNotIn("三阶段", prompt)
        kite = service.build_minimax_h3_writer_request("一个小男孩在草地上放风筝", "镜头缓慢推近，加上风声", "T2VA", 5)
        self.assertIn("- 加上风声", kite)
        self.assertNotIn("光线", kite.split("概述：")[1])

    def test_nearly_identical_first_and_last_frames_keep_the_pose(self):
        from PIL import Image, ImageDraw
        import base64, io

        def url(box):
            image = Image.new("RGB", (96, 96), "gray")
            ImageDraw.Draw(image).rectangle(box, fill="white")
            buffer = io.BytesIO()
            image.save(buffer, "PNG")
            return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()
        pair = lambda a, b: [{"label": "<Picture 1>", "dataUrl": url(a)}, {"label": "<Picture 2>", "dataUrl": url(b)}]
        self.assertTrue(service.minimax_h3_frames_nearly_same(pair((10, 10, 40, 40), (11, 10, 41, 40))))
        self.assertFalse(service.minimax_h3_frames_nearly_same(pair((10, 10, 40, 40), (50, 50, 90, 90))))
        self.assertFalse(service.minimax_h3_frames_nearly_same([{"label": "<Picture 1>", "dataUrl": "data:image/jpeg;base64,/9j/AAAA"}]))
        same = service.build_minimax_h3_writer_request("从首帧自然过渡到尾帧", "", "FL2VA", 5, sees_frames=True, same_frames=True)
        self.assertIn("这两张图几乎相同：画面里每个人物和动物全程保持图中的姿态和位置", same)
        self.assertIn("不加图中没有的光效", same)
        self.assertIn("\n收束：动作怎样平稳完成，最后的画面与 <Picture 2> 一致\n", same)
        self.assertNotRegex(same, "胸肩|呼吸待机|- 从首帧|光影轻微变化|光效变成|真正做出来")
        differing = service.build_minimax_h3_writer_request("从首帧自然过渡到尾帧", "", "FL2VA", 5, sees_frames=True)
        self.assertNotIn("几乎相同", differing)
        self.assertIn("姿态、位置和光效变成 <Picture 2> 的样子", differing)
        answer = phases().replace("1. 保持橘猫外观一致", "1. 保持图中的姿态不变")
        self.assertIn("保持图中的姿态不变", compile_action_phases(answer, "FL2VA", 5, "从首帧自然过渡到尾帧", keep_pose=True))
        self.assertNotIn("保持图中的姿态不变", compile_action_phases(answer, "FL2VA", 5, "从首帧自然过渡到尾帧"))

    def test_i2v_and_fl2v_models_see_their_frames(self):
        frame = "data:image/jpeg;base64,/9j/AAAA"
        with mock.patch.object(service, "data_url_to_tensor", side_effect=lambda url: ("tensor", url)):
            result, calls = self.run_local([phases()], {"h3Mode": "image_video", "currentPrompt": "她转身向镜头挥手",
                                                        "h3ReferenceFrames": [{"label": "<Picture 1>", "dataUrl": frame}]})
            prompt, kwargs = calls[0]
            self.assertEqual(kwargs["images"], [("tensor", frame)])
            self.assertEqual(prompt.count(service.QWEN3_CHAT_VISION_TOKEN), 1)
            self.assertIn("<Picture 1> 是视频的第一帧", prompt)
            self.assertTrue(result["positivePrompt"].startswith("integrated_multimodal_description: [Shot 1] 橘猫趴在"))
            self.assertIn("镜头从侧面跟随。画面从 <Picture 1> 开始，橘猫前爪", result["positivePrompt"])
            frames = [{"label": "<Picture 1>", "dataUrl": frame}, {"label": "<Picture 2>", "dataUrl": frame + "B"}]
            result, calls = self.run_local([phases()], {"h3Mode": "first_last", "currentPrompt": "从首帧自然过渡到尾帧", "h3ReferenceFrames": frames})
            prompt, kwargs = calls[0]
            self.assertEqual(len(kwargs["images"]), 2)
            self.assertEqual(prompt.count(service.QWEN3_CHAT_VISION_TOKEN), 2)
            self.assertIn("\n收束：动作怎样平稳完成，姿态、位置和光效变成 <Picture 2> 的样子，最后的画面与 <Picture 2> 一致", prompt)
            self.assertIn("四爪落地，尾巴轻摆，站稳后抬头。结束时画面与 <Picture 2> 一致。", result["positivePrompt"])
            self.assertNotRegex(result["positivePrompt"], r"\[Shot 2\]|\d-\d")
        # An unreadable picture never fails the request; the model is told it cannot see it.
        with mock.patch.object(service, "data_url_to_tensor", side_effect=OSError("broken")):
            result, calls = self.run_local([phases()], {"h3Mode": "image_video", "currentPrompt": "她转身向镜头挥手",
                                                        "h3ReferenceFrames": [{"label": "<Picture 1>", "dataUrl": frame}]})
        prompt, kwargs = calls[0]
        self.assertIsNone(kwargs["images"])
        self.assertNotIn(service.QWEN3_CHAT_VISION_TOKEN, prompt)
        self.assertIn("你看不到这张图", prompt)
        self.assertIn("<Picture 1>", result["positivePrompt"])

    def test_requested_cut_becomes_later_shots_with_program_times(self):
        cut = phases().replace("\n约束", "\n镜头2（第3秒）：近景，橘猫落地后回头看向镜头。\n约束")
        result, calls = self.run_local([cut], {"currentPrompt": CAT + "，第3秒切到近景"})
        prompt = calls[0][0]
        self.assertIn("\n镜头2（第X秒）：用户要求切换镜头", prompt)
        self.assertNotIn("- 第3秒切到近景", prompt)
        self.assertEqual(narrative(result["positivePrompt"]),
                         narrative(CAT_TEXT) + "\n[Shot 2] At 00:03.000 镜头切到近景，橘猫落地后回头看向镜头。")
        # Seconds that do not rise inside the clip are replaced by even spacing; a second cut is shot 3.
        two = cut.replace("镜头2（第3秒）", "镜头2（第9秒）").replace("\n约束", "\n镜头3：特写，橘猫眯起眼睛。\n约束")
        text = compile_action_phases(two, "T2VA", 6, CAT + "，分三个镜头", cut=True)
        self.assertIn("\n[Shot 2] At 00:02.000 镜头切到近景", text)
        self.assertIn("\n[Shot 3] At 00:04.000 镜头切到特写，橘猫眯起眼睛。", text)
        # Without a requested cut the writer's extra shot stays in the one shot.
        single = compile_action_phases(cut, "T2VA", 5, CAT)
        self.assertNotIn("[Shot 2]", single)
        self.assertIn("站稳后抬头。近景，橘猫落地后回头看向镜头。", single)
        # First/last frames: the last frame closes the final shot.
        text = compile_action_phases(cut, "FL2VA", 5, CAT + "，第3秒切到近景", cut=True)
        self.assertIn("\n[Shot 2] At 00:03.000 镜头切到近景，橘猫落地后回头看向镜头。结束时画面与 <Picture 2> 一致。", text)
        # A requested cut the answer ignored is asked for once.
        result, calls = self.run_local([phases(), cut], {"currentPrompt": CAT + "，第3秒切到近景"})
        self.assertEqual(len(calls), 2)
        self.assertIn("镜头2（第X秒）", calls[1][0])
        self.assertIn("[Shot 2] At 00:03.000", result["positivePrompt"])

    def test_a_fields_source_is_read_as_prose_and_keeps_its_sound(self):
        source = CAT_TEXT.replace("与画面动作一致的自然环境声和动作声。", "窗外鸟鸣，猫爪落在木地板上的轻响。")
        answer = phases().replace("缓慢伸懒腰", "舒展地伸了个懒腰").replace("站稳后抬头", "站稳后回头望向窗台")
        result, calls = self.run_local([answer], {"currentPrompt": source})
        prompt = calls[0][0]
        self.assertIn("视频描述：\n橘猫趴在洒满阳光的窗台上", prompt)
        self.assertNotRegex(prompt, r"integrated_multimodal_description|overall_soundscape|\[Shot")
        display = "【画面与动作】\n【镜头 1】橘猫伸懒腰。\n【镜头 2】 At 00:03.000 镜头切到近景。\n\n【环境声音】\n风声\n\n【背景音乐】\n无"
        self.assertEqual(service.h3_base_source_view(display), "橘猫伸懒腰。\n镜头2（第3秒）：镜头切到近景。")
        self.assertIn("舒展地伸了个懒腰", result["positivePrompt"])
        self.assertIn("overall_soundscape: 窗外鸟鸣，猫爪落在木地板上的轻响。", result["positivePrompt"])
        # A new sound is added to it; asked-for music replaces N/A; silence clears both.
        result, _ = self.run_local([answer], {"currentPrompt": source, "requirements": "Source prompt:\n" + source + "\n\n加上风声，配上钢琴曲"})
        self.assertIn("overall_soundscape: 窗外鸟鸣，猫爪落在木地板上的轻响，风声。\n\nnon_diegetic_music: 钢琴曲", result["positivePrompt"])
        result, _ = self.run_local([answer], {"currentPrompt": source, "requirements": "Source prompt:\n" + source + "\n\n完全静音"})
        self.assertIn("overall_soundscape: N/A\n\nnon_diegetic_music: N/A", result["positivePrompt"])
        # A plain source gets the user's facts, else natural ambience; music only when asked.
        result, _ = self.run_local([answer], {"requirements": "Source prompt:\n" + CAT + "\n\n加上风声"})
        self.assertIn("overall_soundscape: 风声\n\nnon_diegetic_music: N/A", result["positivePrompt"])

    def test_translate_only_returns_the_english_copy_without_rewriting(self):
        english = {"写实电影风格，橘猫趴在窗台上，镜头固定，构图保持稳定。": "Live-action, cinematic, an orange cat lies on the windowsill. The camera holds a static shot.",
                   "镜头切到近景，橘猫回头说：LITERAL_0。".replace("LITERAL_0", "TOKEN_0"): "The camera cuts to a close-up and the cat says: TOKEN_0.",
                   "与画面动作一致的自然环境声和动作声。": "Natural ambience and action sounds that match the visuals."}
        fields = ("integrated_multimodal_description: [Shot 1] 写实电影风格，橘猫趴在窗台上，镜头固定，构图保持稳定。\n"
                  "[Shot 2] At 00:03.000 镜头切到近景，橘猫回头说：<d>[Chinese] 喵。</d>。\n\n"
                  "overall_soundscape: 与画面动作一致的自然环境声和动作声。\n\nnon_diegetic_music: N/A")
        assistant = service.PromptAssistant()
        calls = []

        def generate(prompt, **kwargs):
            calls.append(prompt)
            pending = json.loads(prompt.split("Input JSON:\n", 1)[1])
            return json.dumps({key: english[value] for key, value in pending.items()})
        assistant.generate = generate
        result = assistant.optimize_prompt({"purpose": "minimax-h3-prompt-enhance", "h3Mode": "text_video", "durationSeconds": 5, "currentPrompt": fields,
                                            "requirements": "H3 compile: translate-only\nH3 response format: bilingual-v1\nSource prompt:\n" + fields})
        pair = json.loads(result["positivePrompt"])
        self.assertEqual(len(calls), 1)
        self.assertEqual(pair["displayPrompt"], fields)
        self.assertEqual(pair["modelPrompt"],
                         "integrated_multimodal_description: [Shot 1] Live-action, cinematic, an orange cat lies on the windowsill. The camera holds a static shot.\n"
                         "[Shot 2] At 00:03.000, the camera cuts to a close-up and the cat says: <d>[Chinese] 喵。</d>.\n\n"
                         "overall_soundscape: Natural ambience and action sounds that match the visuals.\n\nnon_diegetic_music: N/A")
        # English already: returned as is, no model call.
        calls.clear()
        result = assistant.optimize_prompt({"purpose": "minimax-h3-prompt-enhance", "h3Mode": "first_last", "durationSeconds": 5,
                                            "currentPrompt": "integrated_multimodal_description: [Shot 1] Picture 1 turns into Picture 2.\n\noverall_soundscape: Wind.\n\nnon_diegetic_music: N/A",
                                            "requirements": "H3 compile: translate-only\nSource prompt:\n"})
        self.assertEqual(calls, [])
        self.assertIn("Picture 1 turns into Picture 2.", json.loads(result["positivePrompt"])["modelPrompt"])


if __name__ == "__main__":
    unittest.main()
