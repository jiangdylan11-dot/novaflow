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
                                                validate_base_fields, validate_reference, render_reference_plan, reference_layout,
                                                asks_cut, cut_seconds, shot_times, base_source_view, label_speech)

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
        # The opening's subject is the one the first frame shows (official "the robot shown in <Picture 1>"), after a
        # place that opens it; an opening that does not start with its subject gets the first frame as its own sentence,
        # not glued to the first action.
        self.assertIn("[Shot 1] <Picture 1> 中的机器人原地站立，以细微呼吸表现待机状态。镜头固定，构图保持稳定。", text)
        placed = compile_action_phases(phases.replace("概述：机器人原地站立", "概述：仓库里，机器人原地站立"), "I2VA", 3, source)
        self.assertIn("[Shot 1] 仓库里，<Picture 1> 中的机器人原地站立，以细微呼吸表现待机状态。", placed)
        framed = compile_action_phases(phases.replace("概述：机器人原地站立", "概述：画面里机器人原地站立"), "I2VA", 3, source)
        self.assertIn("[Shot 1] 画面里机器人原地站立，以细微呼吸表现待机状态。镜头固定，构图保持稳定。画面从 <Picture 1> 的位置与构图开始。", framed)
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
        # A frame the text does not name gets the renderer's anchor sentence (validateBaseFields), not an error.
        self.assertIn("[Shot 1] 写实电影风格。画面从 <Picture 1> 的位置与构图开始。女孩抬手。",
                      validate_base_fields(text.replace("<Picture 1> 中的", ""), "I2VA", 6, "zh"))
        self.assertIn("She waves. At the end of the shot, the action settles into the pose, spacing, and composition established by <Picture 2>.\n\n",
                      validate_base_fields(json_form.replace("raises her hand.", "raises her hand. She waves."), "FL2VA", 5, "en"))
        for broken, mode, language in [
                (text.replace("<Picture 1>", "<Picture 2>"), "I2VA", None),                  # I2V has one picture
                (text, "text_video", None),                                                 # T2V has no pictures
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

    def test_refused_cuts_other_phrasings_and_user_cut_times(self):
        for asked in ["第3秒切近景", "然后切近景", "最后切一个特写", "中间切一个猫的特写镜头", "第4秒切回全景", "two shots", "2 shots", "multiple shots"]:
            self.assertTrue(requested_cut(asked), asked)
        for refused in ["不要两个镜头，一个镜头拍完", "不需要任何镜头切换", "请勿切镜", "勿切换镜头", "不能切镜头", "不要出现第二个镜头", "不要多个镜头",
                        "禁止切换镜头，第二个镜头也不要", "do not cut to another scene", "don't cut to a close-up", "no scene change",
                        "without a scene change", "厨师切开西瓜的特写"]:
            self.assertFalse(requested_cut(refused), refused)
        # The requirement's own word on cuts wins over the shots a prompt already has.
        shots = "integrated_multimodal_description: [Shot 1] 猫。\n[Shot 2] At 00:02.000 镜头切到近景。\n\noverall_soundscape: N/A\n\nnon_diegetic_music: N/A"
        self.assertFalse(asks_cut(shots, "改成一个镜头"))
        self.assertFalse(asks_cut(shots, "不要切镜头，动作慢一点"))
        self.assertTrue(asks_cut(shots, "动作慢一点"))
        self.assertTrue(asks_cut("猫跳下窗台", "第3秒切到近景"))
        self.assertEqual(cut_seconds("女孩挥手，第4秒切到近景，6秒后切到远景"), [4.0, 6.0])
        # Known times stay; a missing or invalid one is spaced between its neighbours; hints fill the writer's gaps.
        for asked, hints, expected in [([2.0, None], (), [2.0, 3.5]), ([None, None], (), [1.667, 3.333]), ([4.9999], (), [2.5]),
                                       ([3.0, 2.0], (), [3.0, 4.0]), ([None], (4.0,), [4.0]), ([1.0, 1.0004], (), [1.0, 3.0])]:
            self.assertEqual(shot_times(asked, 5, hints), expected, asked)

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
        # The folded shot keeps its action, not its cut, so a later optimize does not read a cut into it.
        self.assertIn("镜头跟随。<Subject 1> 回头。", single)
        self.assertFalse(requested_cut(single))
        self.assertNotIn("[Shot 2]", render_reference_plan(json.dumps(plan, ensure_ascii=False), inventory, 5, "猫跳下桌子，不要两个镜头"))
        self.assertIn("\n[Shot 2] At 00:03.000 镜头切到近景",
                      render_reference_plan(json.dumps(plan, ensure_ascii=False).replace("[Shot 2]", "\\n[Shot 2]"), inventory, 5, "猫跳下桌子，第3秒切到近景"))

    def test_reference_layout_follows_the_official_guide(self):
        # The style sentence stands before [Shot 1]; each shot is one line, no blank lines inside the field.
        plan = {"references": [{"label": "<Subject 1>", "sources": ["<Picture 1>"], "description": "橘猫", "keep": "橘色长毛"}],
                "tasks": ["reference generation"], "summary": "<Subject 1> 跳下桌子。", "soundscape": "N/A", "music": "N/A",
                "description": "视频采用写实照片风格。\n[Shot 1] 场景是客厅。\n<Subject 1> 跳下桌子。\n\n<Subject 1> 回头。\n\n[Shot 2] At 00:03.000 镜头切到近景，<Subject 1> 坐下。"}
        text = render_reference_plan(json.dumps(plan, ensure_ascii=False), "Available resource labels: <Picture 1>", 5, "猫跳下桌子，第3秒切到近景")
        # A subject from one picture is defined as the one that picture shows (official "<Subject 1> is the young woman
        # in <Picture 1>, with ..."); one that is not a plain noun keeps its source after it.
        self.assertIn("subject_definitions:\n<Subject 1>: <Picture 1> 中的橘猫\n", text)
        plan["references"][0]["description"] = "身穿红袍的武将"
        self.assertIn("subject_definitions:\n<Subject 1>: 身穿红袍的武将 素材来源：<Picture 1>。",
                      render_reference_plan(json.dumps(plan, ensure_ascii=False), "Available resource labels: <Picture 1>", 5, "猫跳下桌子，第3秒切到近景"))
        plan["references"][0]["description"] = "橘猫"
        # A planner that leaves out keep keeps what the subject's description says.
        keepless = dict(plan, references=[{key: value for key, value in plan["references"][0].items() if key != "keep"}])
        self.assertIn("<Subject 1>: fully_preserved - 橘猫",
                      render_reference_plan(json.dumps(keepless, ensure_ascii=False), "Available resource labels: <Picture 1>", 5, "猫跳下桌子，第3秒切到近景"))
        self.assertIn("detailed_description:\n视频采用写实照片风格。\n[Shot 1] 场景是客厅。<Subject 1> 跳下桌子。<Subject 1> 回头。\n"
                      "[Shot 2] At 00:03.000 镜头切到近景，<Subject 1> 坐下。\n\noverall_soundscape:", text)
        english = text.replace("场景是客厅。<Subject 1> 跳下桌子。<Subject 1> 回头。", "A living room.\n\n<Subject 1> jumps off the table.")
        self.assertIn("[Shot 1] A living room. <Subject 1> jumps off the table.\n[Shot 2]", reference_layout(english))
        # validate_reference keeps the layout it is given, as the renderer's validateReference does
        # (h3-multireference.test.mjs holds both to the same text).
        self.assertEqual(validate_reference(english, "Available resource labels: <Picture 1>", 5), english)
        inline = english.replace("视频采用写实照片风格。\n[Shot 1]", "视频采用写实照片风格。 [Shot 1]")
        self.assertEqual(validate_reference(inline, "Available resource labels: <Picture 1>", 5), inline)


PHASES = ["橘猫趴在洒满阳光的窗台上，镜头从侧面跟随。", "橘猫前爪向前伸直，背部下压，缓慢伸懒腰。",
          "后腿蹬起，身体前倾，从窗台一跃而下。", "四爪落地，尾巴轻摆，站稳后抬头。", "1. 保持橘猫外观一致\n2. 动作连贯"]
CAT = "一只橘猫在窗台上伸懒腰，然后跳下窗台"
# The camera is its own sentence after the opening composition (official "The camera holds a static shot."), not a label
# tacked onto the list of subjects.
CAT_TEXT = ("integrated_multimodal_description: [Shot 1] 橘猫趴在洒满阳光的窗台上。镜头从侧面跟随。橘猫前爪向前伸直，背部下压，缓慢伸懒腰。"
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
        # Constraints are limits the user set: none here, so none of the writer's stay.
        self.assertIn("镜头从侧面跟随。橘猫前爪", text)
        self.assertNotIn("背景保持不变", text)
        # The pose leaves "姿态和背景保持不变"; the user's own "背景保持不变" stays.
        self.assertIn("镜头从侧面跟随。背景保持不变。橘猫前爪", compile_action_phases(answer, "T2VA", 5, CAT + "，背景保持不变"))
        self.assertNotIn("不改变初始姿态", text)
        self.assertIn("不改变初始姿态", compile_action_phases(answer, "T2VA", 5, "橘猫蹲坐在窗台上，保持静止"))

    def test_first_last_frame_video_ends_on_its_last_frame_not_a_loop(self):
        answer = ("概述：女神在台阶上静坐，镜头固定。\n起始：权杖上的光点缓缓飘起。\n递进：光点绕着权杖慢慢旋转。\n"
                  "收束：光点落定，画面与 < Picture 2 > 一致。\n约束：1. 外观与背景和两张图一致")
        result, _ = self.run_local([answer], {"h3Mode": "first_last", "currentPrompt": "从首帧无缝过渡到尾帧"})
        self.assertIn("画面与 <Picture 2> 一致。", result["positivePrompt"])
        self.assertIn("[Shot 1] <Picture 1> 中的女神在台阶上静坐。镜头固定。权杖上的光点", result["positivePrompt"])
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
        # Constant facts join the opening; the repeated camera goes, the shot ends on its ending. The hiss is the sound
        # of the tongue the user asked for (a creative addition inside the user's framework); music is not asked for.
        self.assertIn("[Shot 1] <Picture 1> 中的巨蛇在灰色背景中缓缓抬头。镜头固定。巨蛇头部缓慢向上抬起。头部继续抬升，信子从口中探出，发出嘶嘶声。"
                      "信子收回，镜头停在巨蛇头部。\n\n", text)
        for gone in ["初始姿态", "定格", "三阶段", "原提示词", "音乐", "外观和背景须与图一致", "镜头全程固定"]:
            self.assertNotIn(gone, text)
        self.assertNotIn("配乐", compile_action_phases(answer.replace("发出嘶嘶声", "发出嘶嘶声，伴着低沉的配乐"), "I2VA", 8, "巨蛇缓缓抬头，吐出信子"))
        self.assertIn("低沉的配乐", compile_action_phases(answer.replace("发出嘶嘶声", "发出嘶嘶声，伴着低沉的配乐"), "I2VA", 8, "巨蛇缓缓抬头，配上音乐"))
        # The user's own return, loop or ban is kept.
        self.assertIn("回落至初始姿态", compile_action_phases(answer, "I2VA", 8, "巨蛇抬头，再回到原来的位置"))
        self.assertIn("音乐", compile_action_phases(answer, "I2VA", 8, "巨蛇缓缓抬头，不要音乐"))

    def test_one_camera_move_and_light_only_against_the_users_time(self):
        answer = ("概述：厨师在厨房颠锅炒菜，镜头跟随锅身，暖色调灯光下火光交织。\n起始：厨师手臂下压，锅身前倾。\n"
                  "递进：厨师手腕上抖，食材翻起，镜头推近捕捉火光。\n收束：锅落回灶台，镜头拉远展现厨房。\n"
                  "约束：1. 场景始终为厨房，光线保持明亮\n2. 镜头全程跟随，不使用俯拍或仰拍\n3. 不得添加其他人物或道具")
        text = compile_action_phases(answer, "T2VA", 5, "厨师在厨房里颠锅炒菜，锅里火焰窜起")
        # The writer lights the scene as it likes (atmosphere inside the user's framework); one camera move stays.
        self.assertIn("[Shot 1] 厨师在厨房颠锅炒菜，镜头跟随锅身，暖色调灯光下火光交织。厨师手臂下压，锅身前倾。厨师手腕上抖，食材翻起。锅落回灶台。\n", text)
        # Light at another time than the user's words say goes; weather under the user's clear sky too.
        sunny = answer.replace("暖色调灯光下火光交织", "午后阳光洒进厨房")
        self.assertNotIn("阳光", compile_action_phases(sunny, "T2VA", 5, "夜晚的厨房里，厨师颠锅炒菜"))
        self.assertIn("午后阳光洒进厨房", compile_action_phases(sunny, "T2VA", 5, "厨师在厨房里颠锅炒菜"))
        self.assertNotIn("细雨", compile_action_phases(answer.replace("暖色调灯光下火光交织", "窗外细雨飘落"), "T2VA", 5, "晴朗的午后，厨师颠锅炒菜"))
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
        # None of these is a limit the user set ("尾巴始终可见" while the cat jumps): the shot goes on with the action.
        self.assertIn("镜头从侧面跟随。橘猫前爪", text)
        self.assertNotRegex(text, "始终|全程")
        # The user's own limit is kept with the writer's wording of it.
        self.assertIn("镜头从侧面跟随。尾巴始终可见。橘猫前爪", compile_action_phases(answer, "T2VA", 5, CAT + "，尾巴始终露在画面里"))
        # So is a limit stated as a wish, or written in English.
        limited = phases().replace("1. 保持橘猫外观一致\n2. 动作连贯", "1. 背景始终为纯白色\n2. 画面中不出现任何文字")
        self.assertIn("镜头从侧面跟随。背景始终为纯白色。橘猫前爪", compile_action_phases(limited, "T2VA", 5, CAT + "，背景要纯白"))
        self.assertIn("镜头从侧面跟随。背景保持不变。画面中不出现任何文字。橘猫前爪",
                      compile_action_phases(limited.replace("背景始终为纯白色", "背景保持不变"), "T2VA", 5,
                                            "An orange cat stretches on the windowsill. Keep the background unchanged and do not add any on-screen text."))
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
        # Left and right the user never wrote go (the small model mirrors them), with no demonstrative left behind;
        # the user's own side stays. The stroke's invented glow goes; scene light the writer adds is atmosphere.
        self.assertIn("二郎神一只手举刀。手臂向前挥出，披风翻飞。刀停在身前。", text)
        self.assertIn("灯笼的光斑", compile_action_phases(answer.replace("披风翻飞", "披风翻飞，灯笼的光斑落在地上"), "I2VA", 5, "二郎神举刀向前劈砍"))
        self.assertIn("二郎神右手举刀。右臂向前挥出", compile_action_phases(answer, "I2VA", 5, "二郎神右手举刀向前劈砍"))
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
        # The speaker is named with a voice at the first line, as the official "The old man with a low, slow voice (S1) says:"
        # form asks; a robot speaks in an electronic voice when the answer gives none.
        self.assertIn("小机器人抬头面向镜头，开始说话。电子音轻快的小机器人 (S1) 说：<d>[Chinese] 今天的花开得真好。</d>他说完这句话，水流渐停。", text)
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
        # A place or direction the answer gives ("移到右侧") stays; only the side of a limb goes.
        self.assertIn("灯光扫过表面。灯光移到右侧，奖杯静止。", text)
        self.assertIn("奖杯从图中姿态开始", text)
        text = compile_action_phases(answer.replace("旋转至图中姿态", "旋转至图中初始倾斜角度"), "I2VA", 5, "奖杯缓缓旋转，灯光扫过表面")
        self.assertIn("灯光扫过表面。灯光移到右侧，奖杯静止。", text)
        # "锅里火焰窜起" does not end with the fire going out, unless the user says so.
        chef = ("概述：厨师在厨房里颠锅炒菜，镜头固定。\n起始：厨师双手握锅柄向上提锅。\n递进：食材在锅里翻起，火焰随锅势窜起。\n"
                "收束：锅落回灶台，火焰瞬间熄灭，厨师手仍握锅柄。\n约束：1. 场景始终为厨房")
        self.assertIn("火焰随锅势窜起。锅落回灶台，厨师手仍握锅柄。", compile_action_phases(chef, "T2VA", 5, "厨师在厨房里颠锅炒菜，锅里火焰窜起"))
        self.assertIn("火焰瞬间熄灭", compile_action_phases(chef, "T2VA", 5, "厨师颠锅，锅里火焰窜起后熄灭"))
        # A roar that fits the glare is an expression the writer may add; a line it puts in his mouth is not the
        # user's and goes (no new dialogue).
        answer = ("概述：钟馗持剑怒视前方，镜头固定。\n起始：钟馗身体前倾。\n递进：钟馗怒吼发力，剑身向上挑起。\n"
                  "收束：钟馗说出“收！”\n约束：1. 背景始终为纯白")
        text = compile_action_phases(answer, "I2VA", 5, "钟馗拔剑怒视前方")
        self.assertIn("[Shot 1] <Picture 1> 中的钟馗持剑怒视前方。镜头固定。钟馗身体前倾。钟馗怒吼发力，剑身向上挑起。\n\n", text)
        self.assertNotIn("收！", text)
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
        # The overview is the opening picture; the actions are told once, in the beats.
        self.assertIn("再用一两句写开场画面：用视频描述里的原词写主体是谁、在什么场景、在画面中的位置和景别", kite)
        self.assertIn("不写动作过程", kite)
        self.assertIn("\n约束：只写用户写明要一直保持或禁止的内容，写成画面里看得见的样子", kite)
        self.assertIn("没写就写写实电影风格", kite)
        self.assertNotIn("真正做出来", service.build_minimax_h3_writer_request("女战士站立，仅呼吸待机", "", "T2VA", 3))
        # A picture the model cannot see gets no style guess.
        self.assertNotIn("画风", service.build_minimax_h3_writer_request("她转身向镜头挥手", "", "I2VA", 5))

    def test_rules_the_user_asked_for_stay_as_what_is_on_screen(self):
        # The live writer copied the rule lines themselves; only their visible content reaches the shot.
        answer = ("概述：写实电影风格；绿幕前的机器人原地待机，全景固定镜头拍摄\n起始：胸肩随呼吸微微向下起伏，回落至原位，幅度极小\n"
                  "递进：胸肩随呼吸微微向上隆起，再缓慢回落，节奏轻柔持续\n收束：胸肩随呼吸回落至原位，动作平滑衔接起始姿态，首尾无缝循环\n"
                  "约束：1. 仅呼吸待机：只写胸肩随呼吸微微起伏、回落；2. 头部朝向、手臂和身体位置保持不变，不要写成抬头、转头或抬手；"
                  "3. 纯色背景：背景颜色、亮度和质感全程不变，不添加阴影、渐变、场景或光效")
        text = compile_action_phases(answer, "T2VA", 8, "绿幕前的机器人原地待机，轻微呼吸，循环动画")
        self.assertIn("全景固定镜头拍摄。头部朝向、手臂和身体位置保持不变。背景颜色、亮度和质感全程不变。胸肩随呼吸", text)
        self.assertNotRegex(text, "只写|不要写|仅呼吸待机|纯色背景：")

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
        # Nobody talks in this answer: the one line goes after the sentence with the user's action before it (抬头),
        # named by the answer's subject with a voice, without a second call.
        self.assertIn("站稳后抬头。声音清晰的橘猫 (S1) 说：<d>[Chinese] 今天的花开得真好。</d>", text)
        ready = "概述：三维渲染，机器人面向镜头站立，镜头固定。\n起始：机器人面向镜头准备挥手。\n递进：机器人抬起一只手，向镜头挥动。\n收束：机器人放下手。\n约束：无"
        # "面向镜头准备挥手" only gets ready: it goes, and the wave is written where it happens.
        self.assertIn("机器人抬起一只手，向镜头挥动。电子音轻快的机器人 (S1) 说：<d>[Chinese] 出发吧。</d>机器人放下手。",
                      compile_action_phases(ready, "I2VA", 5, base_source_view("<Picture 1> 抬手向镜头挥手并说：“出发吧。”")))
        result, calls = self.run_local([phases()], {"h3Mode": "image_video", "currentPrompt": CAT + "，站稳后抬头说：“喵。”"})
        self.assertEqual(len(calls), 1)
        self.assertIn("站稳后抬头。声音清晰的橘猫 (S1) 说：<d>[Chinese] 喵。</d>", result["positivePrompt"])
        prompt = service.build_minimax_h3_writer_request(source, "", "I2VA", 5, sees_frames=True, dialogue_lines=['(S1)："今天的花开得真好。"'])
        self.assertIn("- 小机器人给花浇水\n- 抬头对镜头说话\n", prompt)
        self.assertIn("只写说话，不写嘴和口型", prompt)
        self.assertNotIn("灯光", prompt)
        self.assertIn("写清它从画面哪里出现", prompt)
        self.assertNotIn("三阶段", prompt)
        kite = service.build_minimax_h3_writer_request("一个小男孩在草地上放风筝", "镜头缓慢推近，加上风声", "T2VA", 5)
        self.assertIn("- 加上风声", kite)
        # Without a picture the writer may furnish and light the user's scene.
        self.assertIn("可以补充合适的场景陈设、时间和光线", kite.split("概述：")[1])

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
        # The pose is kept by the ending on <Picture 2>, never by a "remains unchanged" note inside the shot.
        answer = phases().replace("1. 保持橘猫外观一致", "1. 保持图中的姿态不变")
        for keep in (True, False):
            text = compile_action_phases(answer, "FL2VA", 5, "从首帧自然过渡到尾帧", keep_pose=keep)
            self.assertNotIn("保持图中的姿态不变", text)
            self.assertIn("结束时画面与 <Picture 2> 一致。", text)

    def test_i2v_and_fl2v_models_see_their_frames(self):
        frame = "data:image/jpeg;base64,/9j/AAAA"
        with mock.patch.object(service, "data_url_to_tensor", side_effect=lambda url: ("tensor", url)):
            result, calls = self.run_local([phases()], {"h3Mode": "image_video", "currentPrompt": CAT,
                                                        "h3ReferenceFrames": [{"label": "<Picture 1>", "dataUrl": frame}]})
            prompt, kwargs = calls[0]
            self.assertEqual(kwargs["images"], [("tensor", frame)])
            self.assertEqual(prompt.count(service.QWEN3_CHAT_VISION_TOKEN), 1)
            self.assertIn("<Picture 1> 是视频的第一帧", prompt)
            self.assertTrue(result["positivePrompt"].startswith("integrated_multimodal_description: [Shot 1] <Picture 1> 中的橘猫趴在"))
            self.assertIn("镜头从侧面跟随。橘猫前爪", result["positivePrompt"])
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
            result, calls = self.run_local([phases()], {"h3Mode": "image_video", "currentPrompt": CAT,
                                                        "h3ReferenceFrames": [{"label": "<Picture 1>", "dataUrl": frame}]})
        prompt, kwargs = calls[0]
        self.assertIsNone(kwargs["images"])
        self.assertNotIn(service.QWEN3_CHAT_VISION_TOKEN, prompt)
        self.assertIn("你看不到这张图", prompt)
        self.assertIn("<Picture 1>", result["positivePrompt"])

    def test_the_frames_are_checked_only_on_an_explicit_clue(self):
        frame = "data:image/jpeg;base64,/9j/AAAA"
        # Only the AI 助手 dialog sends sensitiveVisualAnalysis=true, and only its request is checked.
        dialog = {"contentPolicy": {"sensitiveVisualAnalysis": True, "allSubjectsConfirmedAdult": False}}
        i2v = {"h3Mode": "image_video", "currentPrompt": CAT, "h3ReferenceFrames": [{"label": "<Picture 1>", "dataUrl": frame}], **dialog}
        labels = lambda calls: [kwargs["trace_label"] for _, kwargs in calls]
        with mock.patch.object(service, "data_url_to_tensor", side_effect=lambda url: ("tensor", url)):
            # Ordinary words and an ordinary answer: no age is judged, no extra look, one call.
            for words in [CAT, "她在海边转身，望向远处", "女孩转身", "女孩子在海边转身", "他孩子气地笑着转身", "二十岁的女子转身"]:
                with self.subTest(words=words):
                    result, calls = self.run_local([phases()], {**i2v, "currentPrompt": words})
                    self.assertEqual(labels(calls), ["minimaxH3PromptEnhance"])
                    self.assertIn("按下面的格式输出六行", calls[0][0])
                    self.assertNotIn("未成年", calls[0][0])
                    self.assertIn("橘猫", result["positivePrompt"])
            # A child the user names: the pictures are looked at once before anything is written; with sensitive
            # pictures it is blocked and nothing is written.
            young = {**i2v, "currentPrompt": "小孩在卧室里转身"}
            result, calls = self.run_local(["检查：未成年=无；敏感=无", phases()], young)
            self.assertEqual(labels(calls), ["minimaxH3FrameCheck", "minimaxH3PromptEnhance"])
            self.assertEqual(calls[0][1]["images"], [("tensor", frame)])
            self.assertTrue(calls[0][0].endswith(service.MINIMAX_H3_FRAME_CHECK))
            self.assertNotIn("未成年", calls[1][0])
            assistant, seen = service.PromptAssistant(), []
            assistant.generate = lambda prompt, **kwargs: seen.append(kwargs["trace_label"]) or "未成年=无；敏感=有"
            with self.assertRaises(service.VisualContractError) as raised:
                assistant.optimize_prompt({"purpose": "minimax-h3-prompt-enhance", "durationSeconds": 5, **young})
            self.assertEqual(seen, ["minimaxH3FrameCheck"])
            self.assertEqual(raised.exception.code, "h3-sensitive-minor-request-blocked")
            # Every explicit child word is a clue, in the user's words or the writer's picture lines: a sensitive
            # child picture is blocked as before, whatever word names the child.
            for child in ["小女孩", "小男孩", "女童", "男童", "孩子", "小朋友", "宝宝", "小学生", "初中生", "幼儿园的孩子", "a little girl", "the kid",
                          "十二三岁的女孩", "七八岁的男孩", "十五六岁的少女", "一周岁的婴孩", "12周岁的女孩", "１２岁的女孩", "新生儿", "中学生",
                          "an eight-year-old girl", "a twelve year old boy", "a preteen girl", "a tween", "a newborn", "a schoolgirl", "a 5th grader"]:
                with self.subTest(child=child):
                    with self.assertRaises(service.VisualContractError) as raised:
                        self.run_local(["未成年=有；敏感=有", phases()], {**i2v, "currentPrompt": child + "在卧室里转身"})
                    self.assertIn(raised.exception.code, ["h3-sensitive-young-evidence-blocked", "h3-sensitive-minor-request-blocked"])
                    with self.assertRaises(service.VisualContractError) as raised:
                        self.run_local([phases().replace("橘猫趴在", child + "和橘猫趴在"), "未成年=有；敏感=有"], i2v)
                    self.assertEqual(raised.exception.code, "h3-sensitive-young-evidence-blocked")
            # A child is a clue in any clause ("孩子气喘吁吁", "妇女孩子"); an adult age, a likeness, an animal's young or a
            # name adults call each other is none.
            for words in ["孩子气喘吁吁地跑进卧室", "妇女孩子站在门口", "男女孩子们在操场上奔跑", "十七八岁的少女", "17-18岁的女孩"]:
                self.assertTrue(service.minimax_h3_young_clue(words), words)
            for words in ["十八岁的女子转身", "十八九岁的女子", "三十七岁的男子转身", "五六十岁的老人", "九千岁端坐殿上", "熊猫宝宝在竹林里打滚",
                          "a baby dragon flies over the sea", "情侣互称宝宝，女子转身", "像孩子一样笑着的男子", "孩子般的笑容", "kid leather gloves on the table"]:
                self.assertFalse(service.minimax_h3_young_clue(words), words)
            for words in ["十八岁的女子转身", "九千岁端坐殿上", "熊猫宝宝在竹林里打滚", "a baby dragon flies over the sea", "像孩子一样笑着的男子"]:
                with self.subTest(words=words):
                    _, calls = self.run_local([phases()], {**i2v, "currentPrompt": words})
                    self.assertEqual(labels(calls), ["minimaxH3PromptEnhance"])
            # Whatever label spelling the writer uses, and in its 约束 line too, a child it names has the pictures looked at.
            named = phases().replace("橘猫趴在", "小女孩和橘猫趴在")
            for answer in [phases(form="【{label}】{text}").replace("橘猫趴在", "小女孩和橘猫趴在"), phases(form="{label}\n{text}").replace("橘猫趴在", "小女孩和橘猫趴在"),
                           "\n".join(f"{i + 1}. {line}" if re.match("概述|起始|递进|收束|约束", line) else line for i, line in enumerate(named.split("\n"))),
                           phases().replace("保持橘猫外观一致", "保持小女孩和橘猫外观一致")]:
                with self.subTest(answer=answer):
                    with self.assertRaises(service.VisualContractError) as raised:
                        self.run_local([answer, "未成年=有；敏感=有"], i2v)
                    self.assertEqual(raised.exception.code, "h3-sensitive-young-evidence-blocked")
            # A sensitive word in the writer's picture lines has the pictures looked at for the other half.
            bare = phases().replace("橘猫趴在", "裸露上身的人和橘猫趴在")
            result, calls = self.run_local([bare, "未成年=无；敏感=有"], i2v)
            self.assertEqual(labels(calls), ["minimaxH3PromptEnhance", "minimaxH3FrameCheck"])
            with self.assertRaises(service.VisualContractError) as raised:
                self.run_local([bare, "未成年=有；敏感=有"], i2v)
            self.assertEqual(raised.exception.code, "h3-sensitive-young-evidence-blocked")
            # Sensitive words: the call that sees the frames answers the check line; it is read and removed.
            result, calls = self.run_local([phases() + "\n检查：未成年=无；敏感=无"], {**i2v, "currentPrompt": CAT + "，裸露"})
            self.assertEqual(len(calls), 1)
            self.assertIn("按下面的格式输出七行", calls[0][0])
            self.assertTrue(calls[0][0].endswith("\n" + service.MINIMAX_H3_FRAME_CHECK))
            self.assertNotRegex(result["positivePrompt"] + result["rawOutput"], "检查|未成年|敏感")
            # A writer that leaves the check line out has the pictures looked at on their own.
            with self.assertRaises(service.VisualContractError):
                self.run_local([phases(), "未成年=有；敏感=无"], {**i2v, "currentPrompt": CAT + "，裸露"})
            # A child the writer's picture lines name has the pictures looked at; with sensitive pictures it is blocked.
            child = phases().replace("橘猫趴在", "小孩和橘猫趴在")
            result, calls = self.run_local([child, "检查：未成年=无；敏感=无"], i2v)
            self.assertEqual(labels(calls), ["minimaxH3PromptEnhance", "minimaxH3FrameCheck"])
            with self.assertRaises(service.VisualContractError) as raised:
                self.run_local([child, "未成年=无；敏感=有"], i2v)
            self.assertEqual(raised.exception.code, "h3-sensitive-young-evidence-blocked")
            # The instruction copied back is no answer; minor evidence without sensitive content is no block.
            for check in ["检查：未成年=有或无；敏感=有或无", "未成年=有；敏感=无"]:
                result, _ = self.run_local([check, phases()], young)
                self.assertNotIn("未成年", result["rawOutput"])
            # With sensitive content (the frame check or the user's words) it fails like the local reverse, without a repair call.
            for check, words in [("检查：未成年=有；敏感=有", "她转身向镜头挥手"), ("检查：未成年：有；敏感：无", "explicit nude，她转身向镜头挥手")]:
                with self.subTest(check=check):
                    assistant, calls = service.PromptAssistant(), []
                    assistant.generate = lambda prompt, **kwargs: calls.append(prompt) or phases() + "\n" + check
                    with self.assertRaises(service.VisualContractError) as raised:
                        assistant.optimize_prompt({"purpose": "minimax-h3-prompt-enhance", "durationSeconds": 5, **i2v, "currentPrompt": words})
                    self.assertEqual(raised.exception.code, "h3-sensitive-young-evidence-blocked")
                    self.assertEqual(str(raised.exception), "MiniMax H3 敏感内容检测到明确未成年人证据，已阻断")
                    self.assertEqual(len(calls), 1)
            # A young word in the sounds the writer adds is no clue: nothing is looked at.
            result, calls = self.run_local([phases() + "\n声音：远处传来孩童嬉闹声"], i2v)
            self.assertEqual(labels(calls), ["minimaxH3PromptEnhance"])
            self.assertIn("橘猫", result["positivePrompt"])
            # An old dialog (no policy) and a generation compile (policy false) run as before: nothing is asked
            # or read, and the same words are not checked.
            for policy in [{}, {"contentPolicy": {"sensitiveVisualAnalysis": False, "allSubjectsConfirmedAdult": False}}]:
                with self.subTest(policy=policy):
                    old = {key: value for key, value in i2v.items() if key != "contentPolicy"}
                    result, calls = self.run_local([phases()], {**old, **policy, "currentPrompt": "小孩把钥匙插入锁孔"})
                    self.assertEqual(len(calls), 1)
                    self.assertIn("按下面的格式输出六行", calls[0][0])
                    self.assertNotIn("未成年", calls[0][0])
        # Without frames nothing is asked or read.
        _, calls = self.run_local([phases()], dialog)
        self.assertNotIn("未成年", calls[0][0])
        self.assertIn("按下面的格式输出六行", calls[0][0])
        # The writer keeps the user's person words and assigns no age.
        self.assertIn("女孩就写女孩", service.MINIMAX_H3_WRITER_RULES)
        self.assertIn("不写“成年”“未成年”，也不写年龄", service.MINIMAX_H3_WRITER_RULES)

    def test_a_content_policy_checks_the_users_words_before_any_model_call(self):
        for mode in ["text_video", "image_video", "multi_reference"]:
            # Every explicit child word the user writes is minor evidence, not only 儿童 or minor.
            for payload in [{"currentPrompt": "explicit nude minor"},
                            {"currentPrompt": "", "requirements": "Source prompt:\n\n\nexplicit nude 儿童"},
                            {"currentPrompt": "海边的人", "requirements": "Source prompt:\n海边的人\n\n改成 explicit nude underage"},
                            {"currentPrompt": "小女孩裸体躺在床上"}, {"currentPrompt": "女童裸露上身"}, {"currentPrompt": "宝宝全裸洗澡"},
                            {"currentPrompt": "七八岁的男孩裸体"}, {"currentPrompt": "a little girl naked on the bed"},
                            # Undressing words are nudity words too.
                            {"currentPrompt": "小学生脱光衣服"}, {"currentPrompt": "小女孩光着身子站在床边"},
                            {"currentPrompt": "男童不穿衣服躺着"}, {"currentPrompt": "a little boy undressing"}]:
                with self.subTest(mode=mode, payload=payload):
                    assistant, calls = service.PromptAssistant(), []
                    assistant.generate = lambda prompt, **kwargs: calls.append(prompt) or phases()
                    with self.assertRaises(service.VisualContractError) as raised:
                        assistant.optimize_prompt({"purpose": "minimax-h3-prompt-enhance", "durationSeconds": 5, "h3Mode": mode,
                                                   "contentPolicy": {"sensitiveVisualAnalysis": True}, **payload})
                    self.assertEqual(raised.exception.code, "h3-sensitive-minor-request-blocked")
                    self.assertEqual(calls, [])
        # 多参: the user's child word with a sensitive picture blocks even when the observation says 未成年=无.
        for words in ["图1的女童在卧室里转身", "图1的小学生在卧室里转身", "图1的儿童在卧室里转身"]:
            with self.assertRaises(service.VisualContractError) as raised:
                service.minimax_h3_block_sensitive_minor(words, "", False, True)
            self.assertEqual(raised.exception.code, "h3-sensitive-minor-request-blocked")
        service.minimax_h3_block_sensitive_minor("图1的女子在卧室里转身", "", False, True)
        service.minimax_h3_block_sensitive_minor("不要出现小女孩，图1的女子在卧室里转身", "", False, True)
        # A negated request is no sensitive request.
        # (The answer leaves out the requirement's 看, which is asked about once.)
        result, _ = self.run_local([phases(), phases()], {"contentPolicy": {"sensitiveVisualAnalysis": True}, "requirements": "Source prompt:\n" + CAT + "\n\n不要裸露，小孩在旁边看"})
        self.assertIn("橘猫", result["positivePrompt"])
        # A generation compile is never checked: a translate-only one whatever its policy, and the
        # free text 多参 compile (policy false) gets no check; an old dialog sends no policy.
        fields = "integrated_multimodal_description: [Shot 1] 写实电影风格，医生用听诊器贴着儿童的胸部检查。\n\noverall_soundscape: 环境声。\n\nnon_diegetic_music: N/A"
        for policy in [{"sensitiveVisualAnalysis": False, "allSubjectsConfirmedAdult": False}, {"sensitiveVisualAnalysis": True, "allSubjectsConfirmedAdult": False}]:
            with self.subTest(policy=policy):
                assistant, calls = service.PromptAssistant(), []
                assistant.translate_h3_base = lambda *args, **kwargs: calls.append("translate") or {"positivePrompt": "{}", "negativePrompt": "", "rawOutput": ""}
                assistant.optimize_prompt({"purpose": "minimax-h3-prompt-enhance", "durationSeconds": 5, "h3Mode": "text_video", "currentPrompt": fields,
                                           "requirements": service.H3_TRANSLATE_ONLY + "\nSource prompt:\n" + fields, "contentPolicy": policy})
                self.assertEqual(calls, ["translate"])
        assistant, checks = service.PromptAssistant(), []
        assistant.optimize_h3_reference = lambda *args: checks.append(args[-1]) or {}
        assistant.optimize_h3_base = lambda *args: checks.append(args[-1]) or {}
        for mode in ["multi_reference", "image_video"]:
            for policy in [None, {"sensitiveVisualAnalysis": False, "allSubjectsConfirmedAdult": False}, {"sensitiveVisualAnalysis": True, "allSubjectsConfirmedAdult": False}]:
                assistant.optimize_prompt({"purpose": "minimax-h3-prompt-enhance", "durationSeconds": 5, "h3Mode": mode, "currentPrompt": "<Picture 1> 向镜头挥手",
                                           **({"contentPolicy": policy} if policy else {})})
        self.assertEqual(checks, [False, False, True] * 2)

    def test_a_supplement_alone_is_the_video_description(self):
        # The renderer sends the 补充要求 as the source; an empty source with the 补充要求 after it reads the same.
        result, calls = self.run_local([phases()], {"currentPrompt": CAT, "requirements": "Source prompt:\n" + CAT})
        alone, alone_calls = self.run_local([phases()], {"currentPrompt": "", "requirements": "Source prompt:\n\n\n" + CAT})
        self.assertIn("视频描述：\n" + CAT + "\n", alone_calls[0][0])
        self.assertNotIn("补充要求（本次修改", alone_calls[0][0])
        self.assertEqual(alone_calls[0][0], calls[0][0])
        self.assertEqual(alone["positivePrompt"], result["positivePrompt"])
        with self.assertRaisesRegex(ValueError, "请输入提示词或补充要求"):
            self.run_local([phases()], {"currentPrompt": "", "requirements": "Source prompt:\n"})

    def test_reference_observations_answer_the_minor_check(self):
        frames = [{"label": "<Picture 1>", "dataUrl": "data:image/jpeg;base64,/9j/AAAA"}]
        requirements = "Available resource labels: <Picture 1>\nSource prompt:\n<Picture 1> 中的人物向镜头挥手"
        for check, blocked in [("检查：未成年=无；敏感=无", False), ("检查：未成年=有；敏感=有", True)]:
            with self.subTest(check=check):
                assistant, calls = service.PromptAssistant(), []

                def generate(prompt, **kwargs):
                    calls.append((kwargs.get("trace_label"), prompt))
                    return "画风：写实照片\n主体：穿红色外套的人物\n背景：纯色背景\n" + check if kwargs.get("trace_label") == "minimaxH3ReferenceObserve" else "{}"
                assistant.generate = generate
                with mock.patch.object(service, "data_url_to_tensor", side_effect=lambda url: ("tensor", url)):
                    with self.assertRaises(service.VisualContractError if blocked else ValueError) as raised:
                        assistant._optimize_h3_reference("<Picture 1> 中的人物向镜头挥手", requirements, 5, frames, check=True)
                observe = [prompt for label, prompt in calls if label == "minimaxH3ReferenceObserve"]
                self.assertEqual(len(observe), 1)
                self.assertIn("按下面四行输出", observe[0])
                self.assertIn(service.MINIMAX_H3_FRAME_CHECK, observe[0])
                plans = [prompt for label, prompt in calls if label in ("minimaxH3ReferenceEnhance", "minimaxH3ReferenceRepair")]
                if blocked:
                    # Stopped at the look, before any plan is written.
                    self.assertEqual(raised.exception.code, "h3-sensitive-young-evidence-blocked")
                    self.assertEqual(plans, [])
                else:
                    self.assertIn("穿红色外套的人物", plans[0])
                    self.assertNotRegex(plans[0], "未成年|敏感")
        # A generation compile (no check) observes as before: three lines, nothing asked.
        assistant, calls = service.PromptAssistant(), []
        assistant.generate = lambda prompt, **kwargs: calls.append((kwargs.get("trace_label"), prompt)) or "{}"
        with mock.patch.object(service, "data_url_to_tensor", side_effect=lambda url: ("tensor", url)):
            with self.assertRaises(ValueError):
                assistant._optimize_h3_reference("<Picture 1> 中的人物向镜头挥手", requirements, 5, frames)
        observe = [prompt for label, prompt in calls if label == "minimaxH3ReferenceObserve"]
        self.assertIn("按下面三行输出", observe[0])
        self.assertNotIn("未成年", observe[0])

    def test_minor_evidence_in_one_picture_and_sensitive_content_in_another_block_together(self):
        frames = [{"label": "<Picture 1>", "dataUrl": "data:image/jpeg;base64,/9j/AAAA"}, {"label": "<Picture 2>", "dataUrl": "data:image/jpeg;base64,/9j/BBBB"}]
        requirements = "Available resource labels: <Picture 1>; <Picture 2>\nSource prompt:\n<Picture 1> 和 <Picture 2> 在卧室里相拥"
        second = "画风：写实照片\n主体：长发人物\n背景：卧室\n检查：未成年=无；敏感=有"
        for first in ["画风：写实照片\n主体：短发人物，穿白色T恤\n背景：纯色背景\n检查：未成年=有；敏感=无",
                      "画风：写实照片\n主体：一名幼童，穿白色T恤\n背景：纯色背景\n检查：未成年=无；敏感=无"]:
            with self.subTest(first=first):
                assistant, calls = service.PromptAssistant(), []

                def generate(prompt, **kwargs):
                    calls.append(kwargs.get("trace_label"))
                    if kwargs.get("trace_label") != "minimaxH3ReferenceObserve":
                        return "{}"
                    return first if kwargs["images"][0][1].endswith("AAAA") else second
                assistant.generate = generate
                with mock.patch.object(service, "data_url_to_tensor", side_effect=lambda url: ("tensor", url)):
                    with self.assertRaises(service.VisualContractError) as raised:
                        assistant._optimize_h3_reference("<Picture 1> 和 <Picture 2> 在卧室里相拥", requirements, 5, frames, check=True)
                self.assertEqual(raised.exception.code, "h3-sensitive-young-evidence-blocked")
                # Stopped after the second look, before any plan is written.
                self.assertEqual(calls.count("minimaxH3ReferenceObserve"), 2)
                self.assertNotIn("minimaxH3ReferenceEnhance", calls)

    def test_the_check_is_read_from_its_own_line_or_the_end_of_the_last_line(self):
        body = "概述：写实照片，女子站在海边，固定镜头\n起始：女子抬手\n递进：女子挥手\n收束：女子放下手\n声音：海浪声\n约束：1. 镜头固定"
        for answer, minor, sensitive in [
                (body + "\n检查：未成年人=有；敏感=有", True, True),
                (body + "\n检查：未成年=有；敏感内容=有", True, True),
                (body + "\n检查：未成年=有\n敏感=有", True, True),
                (body + "\n【检查】未成年 有；敏感 无", True, False),
                (body + "\n检查：未成年=有或无；敏感=有或无", False, False),
                (body + "\n" + service.MINIMAX_H3_FRAME_CHECK, False, False),
                (body + "\n检查：未成年人是否出现=否；敏感=无", False, False),
                (body + " 检查：未成年=无；敏感=有", False, True),
                (body + "；未成年=有；敏感=无", True, False)]:
            with self.subTest(answer=answer[len(body):]):
                # Only the check is removed; the 约束 text before an inline check stays.
                self.assertEqual(service.minimax_h3_take_frame_check(answer), (body, minor, sensitive))
        # A one-paragraph observation keeps its description.
        seen = "画面中一只白猫坐在灰色沙发上，背景是米色墙面。"
        self.assertEqual(service.minimax_h3_take_frame_check(seen + "检查：未成年=无；敏感=无"), (seen, False, False))
        self.assertEqual(service.minimax_h3_take_frame_check("主体：白猫\n背景：米色墙面 检查：未成年=无；敏感=无"), ("主体：白猫\n背景：米色墙面", False, False))

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
        # Without a requested cut the writer's extra shot stays in the one shot, without its cut.
        single = compile_action_phases(cut, "T2VA", 5, CAT)
        self.assertNotIn("[Shot 2]", single)
        self.assertIn("站稳后抬头。橘猫落地后回头看向镜头。", single)
        self.assertFalse(requested_cut(single))
        # First/last frames: the last frame closes the final shot.
        text = compile_action_phases(cut, "FL2VA", 5, CAT + "，第3秒切到近景", cut=True)
        self.assertIn("\n[Shot 2] At 00:03.000 镜头切到近景，橘猫落地后回头看向镜头。结尾时，镜头回到 <Picture 2> 的景别与构图，动作落定在 <Picture 2> 的姿态与位置。", text)
        # A requested cut the answer ignored is asked for once.
        result, calls = self.run_local([phases(), cut], {"currentPrompt": CAT + "，第3秒切到近景"})
        self.assertEqual(len(calls), 2)
        self.assertIn("镜头2（第X秒）", calls[1][0])
        self.assertIn("[Shot 2] At 00:03.000", result["positivePrompt"])

    def test_a_fields_source_is_read_as_prose_and_keeps_its_sound(self):
        source = CAT_TEXT.replace("与画面动作一致的自然环境声和动作声。", "窗外鸟鸣，猫爪落在木地板上的轻响。")
        answer = phases().replace("缓慢伸懒腰", "舒展地伸了个懒腰").replace("站稳后抬头", "站稳后抬头望向窗台")
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
        # A plain source gets the user's named sounds as a sentence, else natural ambience; music only when asked.
        result, _ = self.run_local([answer], {"requirements": "Source prompt:\n" + CAT + "\n\n加上风声"})
        self.assertIn("overall_soundscape: 风声清晰可闻。\n\nnon_diegetic_music: N/A", result["positivePrompt"])

    def test_translate_only_returns_the_english_copy_without_rewriting(self):
        # "镜头固定" is only a camera move: the program writes it (TOKEN_0), the model never sees it.
        english = {"写实电影风格，橘猫趴在窗台上，TOKEN_0，构图保持稳定。": "Live-action, cinematic, an orange cat lies on the windowsill; TOKEN_0 and the framing stays stable.",
                   "镜头切到近景，橘猫回头说：LITERAL_0。".replace("LITERAL_0", "TOKEN_0"): "The camera cuts to a medium close-up and the cat says: TOKEN_0.",
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
        self.assertNotIn("镜头固定", calls[0])
        self.assertEqual(pair["displayPrompt"], fields)
        self.assertEqual(pair["modelPrompt"],
                         "integrated_multimodal_description: [Shot 1] Live-action, cinematic, an orange cat lies on the windowsill; the camera holds a static shot and the framing stays stable.\n"
                         "[Shot 2] At 00:03.000, the camera cuts to a medium close-up and the cat says: <d>[Chinese] 喵。</d>\n\n"
                         "overall_soundscape: Natural ambience and action sounds that match the visuals.\n\nnon_diegetic_music: N/A")
        # English already: returned as is, no model call.
        calls.clear()
        result = assistant.optimize_prompt({"purpose": "minimax-h3-prompt-enhance", "h3Mode": "first_last", "durationSeconds": 5,
                                            "currentPrompt": "integrated_multimodal_description: [Shot 1] Picture 1 turns into Picture 2.\n\noverall_soundscape: Wind.\n\nnon_diegetic_music: N/A",
                                            "requirements": "H3 compile: translate-only\nSource prompt:\n"})
        self.assertEqual(calls, [])
        self.assertIn("Picture 1 turns into Picture 2.", json.loads(result["positivePrompt"])["modelPrompt"])

    def test_translate_keeps_every_quote_verbatim_and_names_missing_frames(self):
        # The program's own first-frame sentence is not translated: it keeps its official English (TOKEN_1).
        english = {"写实电影风格，木门被推开，发出TOKEN_0一声。TOKEN_1。TOKEN_2，构图保持稳定。":
                   'Live-action, cinematic. The wooden door opens with a "TOKEN_0" creak.TOKEN_1. TOKEN_2 and the framing stays stable.',
                   "风声。": "Wind."}
        fields = "integrated_multimodal_description: [Shot 1] 写实电影风格，木门被推开，发出“吱呀”一声。镜头固定，构图保持稳定。\n\noverall_soundscape: 风声。\n\nnon_diegetic_music: N/A"
        assistant = service.PromptAssistant()
        templates = []

        def generate(prompt, **kwargs):
            templates.append(kwargs.get("llama_template", ""))
            return json.dumps({key: english[value] for key, value in json.loads(prompt.split("Input JSON:\n", 1)[1]).items()})
        assistant.generate = generate
        pair = json.loads(assistant.translate_h3_base(fields, "I2VA", 5)["positivePrompt"])
        # The quoted sound is the renderer's literal: identical in both halves; the translator's own quotes go.
        self.assertIn("with a “吱呀” creak. The shot begins in the position and framing established by <Picture 1>. "
                      "The camera holds a static shot and the framing stays stable.", pair["modelPrompt"])
        self.assertIn("发出“吱呀”一声。画面从 <Picture 1> 的位置与构图开始。", pair["displayPrompt"])
        self.assertIn("the camera holds a static shot", templates[0])

    def test_translate_keeps_speed_direction_and_the_official_camera_words(self):
        from prompt_assistant.h3_prompt_enhance import camera_english, camera_wording, translation_flips
        # A clause that is only a camera move is written from the official table, with only the modifiers it has.
        for chinese, english in [("镜头缓慢推近", "the camera pushes in at slow speed"), ("镜头以小幅度缓慢推近", "the camera pushes in with small amplitude at slow speed"),
                                 ("镜头拉远", "the camera pulls out"), ("镜头缓缓下移", "the camera pedestals down at slow speed"),
                                 ("镜头向左摇", "the camera pans left"), ("镜头快速向右平移", "the camera trucks right at fast speed"),
                                 ("固定镜头", "the camera holds a static shot"), ("镜头全程固定", "the camera holds a static shot"),
                                 ("镜头跟拍", "the camera follows in a tracking shot"), ("镜头环绕", "the camera moves in an arc shot"),
                                 ("镜头手持轻微晃动", "the camera shakes slightly"), ("镜头大幅晃动", "the camera shakes strongly"),
                                 ("镜头从天际线缓缓下移", ""), ("女孩看向镜头", ""), ("镜头切到近景", "")]:
            self.assertEqual(camera_english(chinese), english, chinese)
        # A vertical move is never a pan; a speed or amplitude the Chinese lacks goes.
        self.assertEqual(camera_wording("镜头从天际线缓缓下移", "The camera slowly pans downward from the skyline."), "The camera slowly tilts down from the skyline.")
        self.assertEqual(camera_wording("镜头从天际线缓缓下移", "The camera slowly pushes down from the skyline."), "The camera slowly pedestals down from the skyline.")
        self.assertEqual(camera_wording("她按下开关", "She pushes down the switch."), "She pushes down the switch.")
        self.assertEqual(camera_wording("女孩走来，镜头拉远。", "The girl walks in as the camera pulls out at slow speed."), "The girl walks in as the camera pulls out.")
        self.assertEqual(camera_wording("镜头缓缓下移", "With the camera panning down from the skyline, the street appears; the camera panned down."),
                         "With the camera tilting down from the skyline, the street appears; the camera tilted down.")
        # Only the camera's own move: the chef's pan and switch, a tail's amplitude or a train's speed stay.
        for chinese, english in [("镜头跟随厨师，他把锅向上抛起，按下开关", "Flipping the pan up, the chef cooks. The camera follows the chef as he pushes down the switch."),
                                 ("尾巴左右摆动，幅度很小", "The tail swings left and right with a small amplitude."), ("列车高速驶过", "The train passes at a fast speed.")]:
            self.assertEqual(camera_wording(chinese, english), english)
        # Speed and direction words that were turned around.
        self.assertEqual(translation_flips("光点流转速度缓慢加快", "The flow of light slowly slows down."), ["加快 means speeds up"])
        self.assertEqual(translation_flips("光点流转速度缓慢加快", "The flow of light slowly speeds up."), [])
        self.assertTrue(translation_flips("镜头缓缓推近", "The camera slowly pulls back."))
        self.assertTrue(translation_flips("镜头缓缓下移", "The camera slowly rises."))
        self.assertFalse(translation_flips("镜头缓缓下移，女孩抬头", "The camera slowly tilts down. The girl looks up."))
        self.assertTrue(translation_flips("女孩向左转身", "The girl turns to the right."))
        self.assertFalse(translation_flips("女孩向左转身，挥动右手", "The girl turns to the left and waves her right hand."))
        self.assertFalse(translation_flips("女孩挥动右手后离开", "The girl waves her right hand and left the room."))
        # The camera's up or down is read in its own clause, the girl's is hers; 慢了下来 and 停下 slow down.
        self.assertFalse(translation_flips("镜头缓缓下摇，女孩站起身。", "The camera slowly tilts down as the girl stands up."))
        self.assertFalse(translation_flips("镜头随着女孩坐下缓缓上移。", "The camera slowly moves up as the girl sits down."))
        self.assertTrue(translation_flips("镜头缓缓上移，女孩坐下。", "The camera slowly tilts down, and the girl sits down."))
        self.assertFalse(translation_flips("音乐越来越快，她的舞步却慢了下来。", "The music grows faster, but her dance steps slow down."))
        self.assertFalse(translation_flips("她加快脚步，随后在门口停下。", "She quickens her pace, then slows down and stops at the door."))
        fields = ("integrated_multimodal_description: [Shot 1] 写实电影风格，镜头从城市天际线缓缓下移。光点流转速度缓慢加快。镜头拉远。\n\n"
                  "overall_soundscape: 远处传来车流声。\n\nnon_diegetic_music: N/A")
        answers = iter([
            {"0": "Live-action, cinematic; the camera slowly pans downward from the city skyline. The light points flow and gradually slow down. TOKEN_0.",
             "1": "Distant traffic can be heard."},
            {"0": "Live-action, cinematic; the camera slowly pans downward from the city skyline. The light points flow and gradually speed up. TOKEN_0."}])
        assistant, requests = service.PromptAssistant(), []

        def generate(prompt, **kwargs):
            requests.append(prompt)
            pending = json.loads(prompt.split("Input JSON:\n", 1)[1])
            self.assertEqual(pending.get("0", "写实电影风格，镜头从城市天际线缓缓下移。光点流转速度缓慢加快。TOKEN_0。"),
                             "写实电影风格，镜头从城市天际线缓缓下移。光点流转速度缓慢加快。TOKEN_0。")
            return json.dumps({key: value for key, value in next(answers).items() if key in pending})
        assistant.generate = generate
        pair = json.loads(assistant.translate_h3_base(fields, "T2VA", 5)["positivePrompt"])
        self.assertEqual(len(requests), 2)
        self.assertIn("Camera words: 下移 -> pedestals down; 缓缓 -> at slow speed.", requests[0])
        self.assertIn("Keep these meanings exact: 加快 means speeds up.", requests[1])
        # The style words open the first sentence with a comma, as the official "Live-action, cinematic, a ..." does.
        self.assertIn("[Shot 1] Live-action, cinematic, the camera slowly tilts down from the city skyline. "
                      "The light points flow and gradually speed up. The camera pulls out.\n\n", pair["modelPrompt"])
        # "最后" is translated with its sentence; "看向镜头" and "镜头前太阳缓缓升起" give the camera no words;
        # a name put back inside a sentence keeps its capital.
        fields = ("integrated_multimodal_description: [Shot 1] 写实电影风格，女孩手持雨伞看向镜头，走进东京街头，最后镜头拉远。镜头前太阳缓缓升起。\n\n"
                  "overall_soundscape: 风声。\n\nnon_diegetic_music: N/A")
        requests.clear()

        def generate(prompt, **kwargs):
            requests.append(prompt)
            if "Input JSON:\n" not in prompt:
                return "Tokyo"
            pending = json.loads(prompt.split("Input JSON:\n", 1)[1])
            return json.dumps({key: "Wind." if value == "风声。" else "Live-action, cinematic; the girl holds an umbrella, looks at the camera and walks into "
                               "the 东京 streets, and finally TOKEN_0. The sun slowly rises in front of the camera." for key, value in pending.items()}, ensure_ascii=False)
        assistant.generate = generate
        pair = json.loads(assistant.translate_h3_base(fields, "T2VA", 5)["positivePrompt"])
        self.assertIn("走进东京街头，最后TOKEN_0。", requests[0])
        self.assertNotIn("Camera words", requests[0])
        self.assertIn("walks into the Tokyo streets, and finally the camera pulls out. The sun", pair["modelPrompt"])

    def test_user_turns_a_multi_shot_prompt_back_into_one_shot(self):
        source = CAT_TEXT.replace("站稳后抬头。", "站稳后抬头。\n[Shot 2] At 00:03.000 镜头切到近景，橘猫回头。")
        cut = phases().replace("\n约束", "\n镜头2（第3秒）：切到近景，橘猫落地后回头看向镜头。\n约束")
        result, calls = self.run_local([cut], {"currentPrompt": source, "requirements": "Source prompt:\n" + source + "\n\n改成一个镜头，不要切镜头"})
        prompt = calls[0][0]
        self.assertNotIn("镜头2（第X秒）", prompt)
        self.assertIn("站稳后抬头。橘猫回头。", prompt)
        self.assertNotIn("- 不要切镜头", prompt)
        self.assertNotIn("[Shot 2]", result["positivePrompt"])
        self.assertIn("站稳后抬头。橘猫落地后回头看向镜头。", result["positivePrompt"])
        # The same prompt with an unrelated edit keeps its shots.
        _, calls = self.run_local([cut], {"currentPrompt": source, "requirements": "Source prompt:\n" + source + "\n\n动作慢一点"})
        self.assertIn("镜头2（第X秒）", calls[0][0])

    def test_sound_fields_follow_the_users_words(self):
        source = CAT_TEXT.replace("与画面动作一致的自然环境声和动作声。", "海浪声。").replace("non_diegetic_music: N/A", "non_diegetic_music: 舒缓的钢琴曲，节奏缓慢。")
        fields, view = service.parse_h3_base_fields(source), base_source_view(source)
        for tail, expected in [("音乐节奏更快一点", ("海浪声。", "舒缓的钢琴曲，节奏缓慢。")), ("去掉背景音乐", ("海浪声。", "N/A")),
                               ("加上海鸥叫声", ("海浪声，海鸥叫声。", "舒缓的钢琴曲，节奏缓慢。")), ("不要任何声音", ("N/A", "N/A")),
                               ("音乐换成吉他", ("海浪声。", "吉他配乐。")), ("保留音乐，加上雷声", ("海浪声，雷声。", "舒缓的钢琴曲，节奏缓慢。")),
                               ("去掉海浪声，加上雨声", ("雨声。", "舒缓的钢琴曲，节奏缓慢。"))]:
            self.assertEqual(service.minimax_h3_base_audio(view, fields, tail)[:2], expected, tail)
        # A plain prompt leaves the soundscape to the writer, with the sounds the user named.
        self.assertEqual(service.minimax_h3_base_audio("女孩在海边挥手，配上钢琴配乐", None, ""), (None, "钢琴配乐。", []))
        self.assertEqual(service.minimax_h3_base_audio("女孩在海边挥手，背景是海浪声和海鸥叫声", None, ""), (None, "N/A", ["海浪声", "海鸥叫声"]))
        answer = phases().replace("\n约束", "\n声音：海浪拍岸声，风吹过窗台的轻响，远处传来钢琴音乐。\n约束")
        text = compile_action_phases(answer, "T2VA", 5, CAT, audio=(None, "N/A", ["海浪声", "海鸥叫声"]))
        # A list of sounds reads as a sentence of sounds heard together (a list says no order: never 随后).
        self.assertIn("overall_soundscape: 海浪拍岸声伴着风吹过窗台的轻响。海鸥叫声清晰可闻。\n\nnon_diegetic_music: N/A", text)
        sentence = compile_action_phases(answer.replace("声音：海浪拍岸声，", "声音：海浪拍打着礁石，"), "T2VA", 5, CAT, audio=(None, "N/A", []))
        self.assertIn("overall_soundscape: 海浪拍打着礁石，风吹过窗台的轻响。\n", sentence)
        self.assertIn("\n声音：用一两句完整的话写画面里听得到的环境声和动作声", service.build_minimax_h3_writer_request(CAT, "", "T2VA", 5))

    def test_each_speaker_talks_where_the_answer_has_them_speak(self):
        source = "女孩站在乡间公路上，朝迎面走来的朋友挥手打招呼，朋友走到她面前回应\n(S1)：“你好。”\n(S2)：“欢迎回来。”"
        answer = ("概述：写实照片，女孩站在乡间小路上，镜头固定。\n起始：女孩抬起右手，朝前方挥手打招呼。\n递进：朋友从画面右侧走进，走到她面前，开口回应。\n"
                  "收束：两人面对面站着，女孩放下手。\n约束：1. 小路始终可见")
        text = compile_action_phases(answer, "I2VA", 5, source)
        self.assertIn("挥手打招呼。声音清亮的女孩 (S1) 说：<d>[Chinese] 你好。</d>朋友从画面右侧走进，走到她面前，开口回应。声音清晰的朋友 (S2) 说：<d>[Chinese] 欢迎回来。</d>两人", text)
        # Both lines in one beat, each after its own sentence (the live answer quoted them itself).
        same_beat = answer.replace("起始：女孩抬起右手，朝前方挥手打招呼。", "起始：女孩抬起右手，女孩开口：“你好。”朋友停下脚步，看向她，回应：“欢迎回来。”")
        self.assertIn("女孩开口。声音清亮的女孩 (S1) 说：<d>[Chinese] 你好。</d>朋友停下脚步，看向她，回应。声音清晰的朋友 (S2) 说：<d>[Chinese] 欢迎回来。</d>",
                      compile_action_phases(same_beat, "I2VA", 5, source))
        # An answer that drops the user's action is asked once more.
        dropped = answer.replace("朋友从画面右侧走进，走到她面前，开口回应。", "女孩面带微笑注视前方走来的友人。").replace("女孩放下手", "友人开口说话")
        result, calls = self.run_local([dropped, answer], {"h3Mode": "image_video", "currentPrompt": source})
        self.assertEqual(len(calls), 2)
        self.assertIn("漏写了视频描述里的“朋友走到她面前回应”", calls[1][0])
        self.assertIn("朋友 (S2) 说：", result["positivePrompt"])
        # So is an answer where nobody talks; a retry that still has nobody talking ends the shot with the lines.
        silent = answer.replace("开口回应", "停下脚步").replace("挥手打招呼", "挥手")
        result, calls = self.run_local([silent, silent], {"h3Mode": "image_video", "currentPrompt": source})
        self.assertIn("对白没有安排说话的时刻", calls[1][0])
        self.assertIn("女孩放下手。(S1) 说：<d>[Chinese] 你好。</d>(S2) 说：<d>[Chinese] 欢迎回来。</d>\n", result["positivePrompt"])
        # Joint speakers and a language tag the program would not write survive a re-optimize.
        fields = ("integrated_multimodal_description: [Shot 1] 两个孩子站在操场上，(S1, S2) 齐声说：<d>[Chinese] 加油！</d>女孩说：<d>[Japanese] がんばれ</d>\n\n"
                  "overall_soundscape: 风声。\n\nnon_diegetic_music: N/A")
        view = base_source_view(fields)
        self.assertIn('(S1, S2)："加油！"', view)
        answer = "概述：两个孩子站在操场上，镜头固定。\n起始：两个孩子举起拳头。\n递进：两个孩子齐声喊话。\n收束：两个孩子放下拳头。\n约束：1. 操场始终可见"
        text = compile_action_phases(answer, "T2VA", 5, view.replace("女孩说：<d>[Japanese] がんばれ</d>", ""))
        self.assertIn("两个孩子齐声喊话。声音清晰的两个孩子 (S1, S2) 说：<d>[Chinese] 加油！</d>", text)
        # A line the answer quoted itself is written once, after its sentence; the answer's own quoted words lose their quotes.
        robot = '小机器人给花浇水，抬头对镜头说话\n(S1)："今天的花开得真好。"'
        copied = ("概述：三维渲染，小机器人在温室里浇水，镜头固定。\n起始：小机器人缓缓抬头，看向镜头。\n递进：小机器人双眼亮起，嘴唇微动开始说话：“今天的花开得真好。”\n"
                  "收束：小机器人说完后静静站着，水珠“嗒”地落下。\n约束：1. 洒水壶始终在右手")
        text = compile_action_phases(copied, "I2VA", 5, robot)
        self.assertIn("双眼亮起，开始说话。电子音轻快的小机器人 (S1) 说：<d>[Chinese] 今天的花开得真好。</d>小机器人说完后静静站着，水珠嗒地落下。", text)
        self.assertEqual(text.count("今天的花开得真好"), 1)
        japanese = "integrated_multimodal_description: [Shot 1] 女孩站在门口，(S1) 说：<d>[Japanese] こんにちは</d>\n\noverall_soundscape: 风声。\n\nnon_diegetic_music: N/A"
        self.assertIn("(S1) 说：<d>[Japanese] こんにちは</d>", compile_action_phases(answer.replace("两个孩子", "女孩"), "T2VA", 5, base_source_view(japanese)))

    def test_unlabelled_speech_is_a_spoken_line_the_program_keeps(self):
        source = "<Picture 1> 抬手向镜头挥手并说：“出发吧。”"
        self.assertEqual(base_source_view(source), '<Picture 1> 抬手向镜头挥手并说\n(S1)："出发吧。"')
        # Speakers follow the sentence that talks: "又说" keeps its speaker, "朋友回答" is another one.
        self.assertEqual(base_source_view("女孩说：“你好。”然后又说：“再见。”朋友回答：“欢迎。”"),
                         '女孩说，然后又说，朋友回答\n(S1)："你好。"\n(S1)："再见。"\n(S2)："欢迎。"')
        self.assertEqual(base_source_view("门上写着“欢迎光临”"), "门上写着“欢迎光临”")
        answer = ("概述：三维渲染，铜绿机器人站在温室小径上，中景，镜头固定。\n起始：机器人右手从身侧缓缓抬起。\n"
                  "递进：手掌张开，朝镜头左右挥动，同时开口说话。\n收束：机器人放下右手，站在原地。\n约束：无")
        result, calls = self.run_local([answer], {"h3Mode": "image_video", "currentPrompt": source})
        self.assertIn("本次有对白", calls[0][0])
        # The speaker is named from the answer's own subject; the side the user never wrote goes, with no demonstrative.
        self.assertIn("朝镜头左右挥动，同时电子音轻快的机器人 (S1) 说：<d>[Chinese] 出发吧。</d>机器人放下手", result["positivePrompt"])
        # The speaker's voice goes with the identity before the ID, outside <d> (official "The young woman with a quiet,
        # breathy voice (S1) says:"); a sentence that only speaks gives way to the line.
        voiced = compile_action_phases(answer.replace("同时开口说话。", "机器人用清脆的电子音开口说。"), "I2VA", 5, base_source_view(source))
        self.assertIn("朝镜头左右挥动，电子音清脆的机器人 (S1) 说：<d>[Chinese] 出发吧。</d>机器人放下手", voiced)
        # The answer's own copy of the words, even without their full stop, is not told twice.
        copied = compile_action_phases(answer.replace("同时开口说话", "手腕轻摆，说出“出发吧”"), "I2VA", 5, base_source_view(source))
        # A clause that only speaks gives way to the line, which does not say it twice.
        self.assertIn("手腕轻摆，电子音轻快的机器人 (S1) 说：<d>[Chinese] 出发吧。</d>", copied)
        self.assertEqual(copied.count("出发吧"), 1)
        # So is a copy with its speaker label on a line of its own (the live retry wrote it that way).
        labelled = compile_action_phases(answer.replace("同时开口说话。", "同时开口说：\n(S1)：\"出发吧。\""), "I2VA", 5, base_source_view(source))
        self.assertIn("朝镜头左右挥动，同时电子音轻快的机器人 (S1) 说：<d>[Chinese] 出发吧。</d>机器人放下手", labelled)
        # A requirement's speech is a line as well; an answer that loses a line is asked again.
        fields = "integrated_multimodal_description: [Shot 1] 机器人站在温室里挥手。\n\noverall_soundscape: N/A\n\nnon_diegetic_music: N/A"
        result, calls = self.run_local([fields, answer], {"h3Mode": "image_video", "currentPrompt": source,
                                                          "requirements": "Source prompt:\n" + source + "\n\n最后喊道“走吧！”"})
        self.assertEqual(len(calls), 2)
        self.assertIn("漏掉了台词“出发吧。”", calls[1][0])
        self.assertIn("(S1) 说：<d>[Chinese] 出发吧。</d>", result["positivePrompt"])
        # The one robot keeps its ID across its lines (official base §4.4).
        self.assertIn("(S1) 说：<d>[Chinese] 走吧！</d>", result["positivePrompt"])
        self.assertNotIn("(S2)", result["positivePrompt"])

    def test_a_speaker_keeps_one_id_and_no_line_is_invented(self):
        view = base_source_view
        # An action before the verb names nobody new; a name met before keeps its ID.
        self.assertEqual(view("女孩挥手说：“你好。”然后转身说：“再见。”"), '女孩挥手说，然后转身说\n(S1)："你好。"\n(S1)："再见。"')
        self.assertEqual(view("店员问道：“要喝点什么？”顾客回答：“一杯拿铁。”店员又说：“好的。”"),
                         '店员问道，顾客回答，店员又说\n(S1)："要喝点什么？"\n(S2)："一杯拿铁。"\n(S1)："好的。"')
        self.assertEqual(view("女孩站在门口挥手\n(S1)：“你好。”\n女孩说：“再见。”"), '女孩站在门口挥手\n(S1)：“你好。”\n女孩说\n(S1)："再见。"')
        self.assertIn('(S2)："嗨。"', view("女孩 (S1) 说：<d>[Chinese] 你好。</d>男孩回答：“嗨。”"))
        # A speaker ID the user wrote stays; a quoted title after 小说/传说 is no speech.
        self.assertEqual(view("女孩(S1)说：“你好。”"), '女孩说\n(S1)："你好。"')
        self.assertEqual(view("女孩坐在窗边读小说“三体”"), "女孩坐在窗边读小说“三体”")
        self.assertEqual(view("老人讲起传说“龙会回来”"), "老人讲起传说“龙会回来”")
        # A requirement goes on with the source's speaker, and a line the source has is not added again.
        source = "女孩站在门口挥手\n(S1)：“你好。”"
        self.assertEqual(label_speech("然后她又说“再见。”", [source, view(source)]), ("然后她又说", ['(S1)："再见。"']))
        self.assertEqual(label_speech("说“你好。”时要微笑", [source, view(source)]), ("说“你好。”时要微笑", []))

    def test_overview_is_the_opening_picture_and_a_cut_stays_out_of_shot_1(self):
        answer = ("概述：写实电影风格，一只橘猫趴在窗台上，然后跳下窗台；固定镜头全程拍摄。\n起始：橘猫前爪向前伸直，缓慢伸懒腰。\n"
                  "递进：后腿蹬起，从窗台一跃而下。\n收束：四爪落地，画面保持静止，尾巴轻摆。\n约束：1. 猫始终在窗台上或窗台边缘附近\n2. 镜头全程固定")
        text = compile_action_phases(answer, "T2VA", 5, CAT)
        # The jump is told once; "猫始终在窗台上" contradicts it; nothing on screen stops mid-shot.
        self.assertIn("[Shot 1] 写实电影风格，一只橘猫趴在窗台上。固定镜头全程拍摄。橘猫前爪", text)
        self.assertEqual(text.count("跳下窗台") + text.count("一跃而下"), 1)
        self.assertNotRegex(text, "始终|画面保持静止")
        self.assertIn("四爪落地，尾巴轻摆。", text)
        self.assertIn("画面保持静止", compile_action_phases(answer, "T2VA", 5, CAT + "，最后保持静止"))
        # A cut: the overview does not narrate it and shot 1 does not show what the user shows after it.
        city = "先是城市夜景全景，然后切到街角咖啡店里的女孩"
        cut = ("概述：写实电影风格；城市夜景全景后切到街角咖啡店里的女孩；固定镜头拍摄全景\n"
               "起始：镜头从城市天际线缓缓下移，城市夜景中车流缓缓移动，远处高楼亮着灯。\n递进：街角处女孩从咖啡店里侧身走出。\n收束：车流继续移动，镜头拉至城市边缘。\n"
               "镜头2（第5秒）：切到中景，女孩坐在咖啡店窗边，双手捧着咖啡杯。\n约束：1. 城市夜景与咖啡店门框始终在画面中")
        text = compile_action_phases(cut, "T2VA", 10, city, cut=True)
        # One camera for the shot: the fixed camera of the overview, not a later 下移 or 拉至.
        # The shot size opens the composition after the style (official "Live-action, cinematic, a full shot ...").
        self.assertIn("[Shot 1] 写实电影风格，全景，固定镜头拍摄。城市夜景中车流缓缓移动，远处高楼亮着灯。车流继续移动。\n"
                      "[Shot 2] At 00:05.000 镜头切到中景，女孩坐在咖啡店窗边", text)
        with self.assertRaisesRegex(ValueError, "第一个镜头"):
            compile_action_phases(cut.replace("镜头从城市天际线缓缓下移，城市夜景中车流缓缓移动，远处高楼亮着灯。", "女孩在咖啡店里。").replace("车流继续移动，镜头拉至城市边缘", "女孩喝咖啡"),
                                  "T2VA", 10, city, cut=True, strict_rules=True)
        # The cut is the next shot's mark, not an event told at the end of shot 1.
        told = compile_action_phases(cut.replace("收束：车流继续移动，镜头拉至城市边缘。", "收束：车流继续移动，第5秒切到咖啡店。"), "T2VA", 10, city, cut=True)
        self.assertIn("车流继续移动。\n[Shot 2] At 00:05.000", told)
        prompt = service.build_minimax_h3_writer_request(city, "", "T2VA", 10, cut=True)
        self.assertIn("“街角咖啡店里的女孩”切换后才出现，不写进第一个镜头", prompt)
        self.assertNotIn("切换后才出现", service.build_minimax_h3_writer_request(CAT, "第3秒切到近景", "T2VA", 5, cut=True))
        # A cut that reframes the same cat, named 橘猫 after it, keeps the cat and its windowsill in shot 1.
        cat = ("概述：写实电影风格，一只橘猫趴在窗台上，中景，镜头固定。\n起始：橘猫蜷缩在窗台上熟睡，闭着眼睛，身体随呼吸轻轻起伏。\n"
               "递进：橘猫的尾巴轻轻摆动一下。\n收束：橘猫继续安睡，耳朵微微抖动。\n镜头2（第3秒）：切到近景，橘猫缓缓睁开眼睛。\n约束：无")
        self.assertIn("[Shot 1] 写实电影风格，中景，一只橘猫趴在窗台上。镜头固定。橘猫蜷缩在窗台上熟睡，闭着眼睛，身体随呼吸轻轻起伏。",
                      compile_action_phases(cat, "T2VA", 5, "一只猫在窗台上睡觉，第3秒切到近景，橘猫睁开眼睛", cut=True, strict_rules=True))
        # Shot 1 showing the later girl is asked again; after that her sentences go whole, no fragment stays.
        shown = cut.replace("递进：街角处女孩从咖啡店里侧身走出。", "递进：车流闪烁。女孩从街角咖啡店侧身走出，脚步轻缓，左手自然垂落。")
        with self.assertRaisesRegex(ValueError, "第一个镜头"):
            compile_action_phases(shown, "T2VA", 10, city, cut=True, strict_rules=True)
        self.assertIn("远处高楼亮着灯。车流闪烁。车流继续移动。\n[Shot 2]", compile_action_phases(shown, "T2VA", 10, city, cut=True))
        # The overview keeps the camera the user asked for, though a beat says it too.
        kite = ("概述：写实电影风格，一个小男孩在草地上放风筝，镜头缓慢推近。\n起始：小男孩双手握紧风筝线向前跑动。\n"
                "递进：他奔跑中身体前倾，镜头缓慢推近，风筝随风起伏。\n收束：他停下脚步，抬头凝视风筝。\n约束：无")
        self.assertIn("[Shot 1] 写实电影风格，一个小男孩在草地上放风筝。镜头缓慢推近。小男孩", compile_action_phases(kite, "T2VA", 5, "一个小男孩在草地上放风筝", "", "镜头缓慢推近"))
        # The user's own freeze frame or still ending stays.
        wave = "概述：写实电影风格，女孩站在海边，中景，镜头固定。\n起始：女孩转身面向镜头。\n递进：女孩抬手挥动。\n收束：女孩微笑，画面定格在她微笑的样子。\n约束：无"
        self.assertIn("女孩微笑，画面定格在她微笑的样子。", compile_action_phases(wave, "T2VA", 5, "女孩在海边转身挥手，最后画面定格在她微笑的样子"))
        self.assertIn("女孩微笑，画面保持静止。", compile_action_phases(wave.replace("画面定格在她微笑的样子", "画面保持静止"), "T2VA", 5, "女孩在海边转身挥手，结尾画面静止两秒"))
        # A subject's move toward the camera is no camera move against the fixed camera.
        self.assertIn("女孩面向镜头后撤一步。", compile_action_phases(wave.replace("女孩抬手挥动", "女孩面向镜头后撤一步"), "T2VA", 5, "女孩在海边抬手后退"))

    def test_cut_times_and_the_first_shots_camera(self):
        answer = ("概述：写实电影风格，一只橘猫在窗台上伸懒腰；镜头全程固定拍摄。\n起始：橘猫前爪前伸伸懒腰。\n递进：橘猫后腿蹬起，身体前倾。\n收束：橘猫跃出窗台，准备切换。\n"
                  "镜头2：近景，橘猫落地后回头。\n约束：1. 窗台边缘始终可见\n2. 第3秒切近景后保持近景不拉远")
        text = compile_action_phases(answer, "T2VA", 5, CAT + "，第4秒切近景", cut=True)
        self.assertIn("镜头固定拍摄。橘猫前爪前伸伸懒腰。橘猫后腿蹬起，身体前倾。橘猫跃出窗台。\n[Shot 2] At 00:04.000 镜头切到近景，橘猫落地后回头。", text)
        self.assertNotRegex(text, "全程|准备切换|不拉远")
        prompt = service.build_minimax_h3_writer_request(CAT, "第4秒切近景", "T2VA", 5, cut=True)
        self.assertIn("再写第一个镜头怎样拍（只选一种）", prompt)
        self.assertIn("视频描述写了位置就用原词", service.build_minimax_h3_writer_request("橘猫坐在台阶上摆尾", "", "FL2VA", 5, sees_frames=True))

    def test_answer_preambles_and_old_five_sections(self):
        rest = "\n起始：橘猫前爪向前伸直。\n递进：后腿蹬起，从窗台一跃而下。\n收束：四爪落地，站稳后抬头。\n约束：1. 窗台始终可见"
        with self.assertRaises(ValueError):
            compile_action_phases("好的，以下是优化后的视频提示词。" + rest, "T2VA", 5, CAT)
        self.assertIn("[Shot 1] 写实电影风格，橘猫趴在窗台上。镜头固定。", compile_action_phases("总述：写实电影风格，橘猫趴在窗台上，镜头固定。" + rest, "T2VA", 5, CAT))
        five = ("【任务定位】\n文生视频，时长5秒。\n\n【说话者】\n无说话者\n\n【递进式详细提示词】\n写实电影风格，橘猫趴在窗台上。\n\n0-1.7s：橘猫前爪向前伸直。\n\n"
                "1.7-3.3s：后腿蹬起，从窗台一跃而下。\n\n3.3-5s：四爪落地，站稳后抬头。\n\n【台词】\n无台词\n\n【连续性与约束】\n1. 窗台始终可见\n2. 环境与动作声音：风声")
        # The old answer never wrote 伸懒腰: the user's own words go in after the subject its beat opens with.
        self.assertIn("[Shot 1] 写实电影风格，橘猫趴在窗台上。镜头固定，构图保持稳定。橘猫在窗台上伸懒腰，前爪向前伸直。后腿蹬起，从窗台一跃而下。四爪落地，站稳后抬头。\n\n",
                      compile_action_phases(five, "T2VA", 5, CAT))

class H3UserWordsTest(unittest.TestCase):
    """What the writer is asked and what the program keeps: the user's own actions in order, no sides or lean-back the
    user never wrote, the first frame as its own sentence, the speaker named, dialogue kept out of the sounds."""

    def test_the_users_actions_are_written_as_those_actions_in_order(self):
        from prompt_assistant.h3_prompt_enhance import action_gap, action_order, action_places
        lost = "机器人右臂缓慢抬起，手掌张开保持不动。"
        self.assertEqual(action_gap("<Picture 1> 抬手向镜头挥手并说", lost, lost), "漏写了用户写的“挥手”：请在起始、递进或收束里写出“挥手”，再写它看得见的样子")
        self.assertIn("的“哈欠”：", action_gap("橘猫打了个哈欠，然后慢慢趴下", "橘猫嘴巴张开。橘猫完全趴下。", "橘猫嘴巴张开。橘猫完全趴下。"))
        early = "猫头部转向镜头。猫后腿发力跃起，稳稳落在桌面上，眼睛直视镜头。"
        self.assertEqual(action_gap("猫咪跳上桌子后回头看镜头", early, early), "“回头看镜头”要写在“猫咪跳上桌子”之后，在它之前不要写")
        # Other words for the same action, in order, pass; "一点", "光点", "回应" name no action; a cut is no action.
        kept = "猫后腿发力跃上桌子，稳稳落地后回头看向镜头。"
        self.assertEqual(action_gap("猫咪跳上桌子后回头看镜头，动作慢一点", kept, kept), "")
        self.assertEqual(action_gap("金色光点随之流转，朋友开口回应，第4秒切到近景", "光点缓缓旋转，朋友开口。", "光点缓缓旋转，朋友开口。"), "")
        self.assertEqual(action_order("猫咪跳上桌子后回头看镜头"), ["猫咪跳上桌子", "回头看镜头"])
        self.assertEqual(action_places("猫咪跳上桌子后回头看镜头，走到她面前，跳到地上"), ["桌子"])
        # The thing after the user's own "旁边的" or "一张"; water, air, rain, light or a shoulder is nothing to set up.
        self.assertEqual([action_places(t) for t in ["橘猫跳上旁边的椅子，然后趴下", "猫跳上前面的桌子", "狗跳到身边的沙发上", "猫跳上一张桌子"]],
                         [["椅子"], ["桌子"], ["沙发"], ["桌子"]])
        self.assertEqual([action_places(t) for t in ["女孩跳入水中", "小鸟跳到空中", "蝴蝶落在女孩肩上", "女孩站在雨中", "她站在阳光下", "橘猫蹲在窗台上"]], [[]] * 6)
        # Words with a verb character in them name no action ("直接", "摆放", "吃惊"); another word for the action passes.
        for words, written in [("机器人直接把洒水壶举到镜头前", "机器人握住洒水壶，手臂缓慢向前抬起，直至壶口贴到镜头前"),
                               ("桌上摆放着花瓶，猫咪走过去", "猫咪缓步走向花瓶"), ("她一脸吃惊地看着镜头", "她睁大眼睛望向镜头"),
                               ("花瓣飞舞", "花瓣在空中飘舞"), ("猫咪回头看镜头", "猫咪缓缓转头，视线从后方转向镜头"), ("一只橘猫在窗台上伸懒腰，然后跳下窗台", "橘猫前爪向前伸直，身体舒展，随后从窗台一跃而下")]:
            self.assertEqual(action_gap(words, written, written), "", words)
        # An action the user rules out is none, and not part of the order the writer is told.
        for words, written in [("猫咪趴在窗台上晒太阳，不要回头", "猫咪趴在窗台上，尾巴轻轻摆动"), ("女孩站在原地，别挥手", "女孩站在原地，头发随风飘动"),
                               ("小狗坐着不动，不要跳", "小狗坐在草地上，耳朵轻轻抖动")]:
            self.assertEqual(action_gap(words, written, written), "", words)
        self.assertEqual(action_order("橘猫趴在窗台上，然后不要回头"), ["橘猫趴在窗台上"])
        # Nor is it a point the answer must write: an answer without it costs no second call.
        good = "概述：写实电影风格，一只橘猫趴在洒满阳光的窗台上，镜头固定\n起始：橘猫眯着眼睛晒太阳\n递进：橘猫尾巴轻轻摆动\n收束：橘猫把头枕在前爪上\n约束：无"
        result, calls = H3BaseLocalTest.run_local(self, [good], {"h3Mode": "image_video", "currentPrompt": "橘猫趴在窗台上晒太阳，不要回头"})
        self.assertEqual(len(calls), 1)
        self.assertNotIn("不要回头", result["positivePrompt"])
        self.assertEqual(action_gap("两人面对面抱拳行礼", "两人相对而立，拱手行礼", "两人相对而立，拱手行礼"), "")
        # The order is read from the action word with its part: "来回摆动" or "转动耳朵" before the jump is no 回头.
        for kept in ["猫咪尾巴来回摆动，后腿发力跳上桌子，稳稳落地后回头看向镜头。", "猫咪转动耳朵，后腿发力跳上桌子，落地后扭头看向镜头。",
                     "猫咪身体微侧，头部转向画面右侧，后腿发力跃起，落在桌子上，头部缓缓转向镜头。"]:
            self.assertEqual(action_gap("猫咪跳上桌子后回头看镜头", kept, kept, missing=False), "")
        # The writer is told the order and the thing to set up; a first answer without them is asked once more.
        request = service.build_minimax_h3_writer_request("猫咪跳上桌子后回头看镜头", "", "I2VA", 5, sees_frames=True)
        self.assertIn("动作的先后顺序：先“猫咪跳上桌子”，再“回头看镜头”；后面的动作不提前写。“回头”之前的动作让主体侧对或背对镜头，回头时才转向镜头。", request)
        self.assertIn("动作要用到：桌子。图中没有的，在用到它之前写清它在画面哪里（如“画面前方的桌子”），再写用到它的动作。", request)
        self.assertIn("先用几个字写图中的画风（如写实照片、动漫插画、三维渲染）", request)
        # The picture sets the opening framing: the writer is not asked for a shot size there.
        self.assertIn("点明开场画面里的主体、场景和光线，再写镜头怎样拍", request)
        self.assertIn("有图时开场的景别由图决定，不另写", service.MINIMAX_H3_WRITER_RULES)
        answer = "概述：写实照片，橘猫端坐在灰色背景前，镜头固定\n起始：橘猫头部转向镜头，看着镜头\n递进：橘猫跃起\n收束：橘猫落在桌面上\n约束：无"
        good = "概述：写实照片，橘猫端坐在灰色背景前，旁边放着一张木桌，镜头固定\n起始：橘猫后腿发力，跳上桌子\n递进：橘猫稳稳落在桌面上\n收束：橘猫回头看向镜头\n约束：无"
        with self.assertRaisesRegex(ValueError, "“回头看镜头”要写在“猫咪跳上桌子”之后.*；“桌子”要在用到它之前出现"):
            compile_action_phases(answer, "I2VA", 5, "猫咪跳上桌子后回头看镜头", strict_rules=True)
        # The table named on the way to it, before the landing, is set up.
        self.assertEqual(compile_action_phases(answer.replace("橘猫跃起", "橘猫朝画面前方的桌子跃起"), "I2VA", 5, "猫咪跳上桌子", strict_rules=True).count("桌"), 2)
        # Neither answer set the table up: the jump goes to it; nothing stands "beside" the cat in <Picture 1>.
        fallback = compile_action_phases(answer, "I2VA", 5, "猫咪跳上桌子后回头看镜头")
        self.assertIn("<Picture 1> 中的橘猫端坐在灰色背景前。镜头固定。橘猫头部转向镜头，看着镜头。橘猫朝桌子跃起。橘猫落在桌面上。", fallback)
        self.assertNotIn("放着", fallback)
        # Rain is no thing: nothing is placed for it.
        self.assertNotIn("放着", compile_action_phases(answer, "I2VA", 5, "女孩站在雨中"))
        text = compile_action_phases(good, "I2VA", 5, "猫咪跳上桌子后回头看镜头", strict_rules=True)
        # The photo style is a video style; the opening's subject is the one the first frame shows, not glued to an action.
        self.assertIn("[Shot 1] 写实电影风格，<Picture 1> 中的橘猫端坐在灰色背景前，旁边放着一张木桌。镜头固定。橘猫后腿发力", text)

    def test_an_action_both_answers_left_out_is_written_in_the_users_words(self):
        from prompt_assistant.h3_prompt_enhance import write_missing_actions
        texts = ["橘猫头部微微后仰，嘴巴张开。", "橘猫缓缓趴下，眼睛眯起。"]
        self.assertEqual(write_missing_actions(texts, "橘猫打了个哈欠，然后慢慢趴下，眯起眼睛", "写实电影风格，一只橘猫坐在灰色背景前。", "橘猫"),
                         ["橘猫打了个哈欠，头部微微后仰，嘴巴张开。", "橘猫缓缓趴下，眼睛眯起。"])
        robot = ["机器人一只手臂缓慢抬起，手掌张开。"]
        self.assertEqual(write_missing_actions(robot, "<Picture 1> 抬手向镜头挥手并说", "温室中铜绿机器人持洒水壶静立。", "温室中铜绿机器人持洒水壶静立。"),
                         ["机器人抬手向镜头挥手，一只手臂缓慢抬起，手掌张开。"])
        # Any answer is filled in, without asking the writer again (no call or time for a missing word).
        answer = "概述：写实电影风格，一只橘猫坐在灰色背景前，镜头固定\n起始：橘猫头部微微后仰，嘴巴张开\n递进：橘猫缓缓趴下\n收束：橘猫眼睛眯起\n约束：无"
        self.assertIn("橘猫打了个哈欠，头部微微后仰", compile_action_phases(answer, "I2VA", 5, "橘猫打了个哈欠，然后慢慢趴下，眯起眼睛"))
        self.assertIn("橘猫打了个哈欠，头部微微后仰", compile_action_phases(answer, "I2VA", 5, "橘猫打了个哈欠，然后慢慢趴下，眯起眼睛", strict_rules=True))
        result, calls = H3BaseLocalTest.run_local(self, [answer], {"h3Mode": "image_video", "currentPrompt": "橘猫打了个哈欠，然后慢慢趴下，眯起眼睛"})
        self.assertEqual(len(calls), 1)
        self.assertIn("橘猫打了个哈欠", result["positivePrompt"])
        # One the user put after the last beat closes it, in the user's order; one the user rules out is never written.
        self.assertEqual(write_missing_actions(["女孩转过身。", "女孩看向镜头。", "女孩微笑。"], "女孩转身，然后挥手，然后笑，最后跳起来", "", "女孩"),
                         ["女孩转过身。", "女孩挥手，看向镜头。", "女孩微笑。女孩跳起来。"])
        self.assertEqual(write_missing_actions(["橘猫趴着晒太阳。"], "橘猫趴在窗台上晒太阳，不要回头", "", "橘猫"), ["橘猫趴着晒太阳。"])

    def test_sides_and_a_lean_back_the_user_never_wrote_go(self):
        from prompt_assistant.h3_prompt_enhance import drop_sides
        # Each pair of limbs counts on its own: a shoulder named after the hands is the first shoulder.
        self.assertEqual(drop_sides(["机器人右臂抬起，右手挥动，左手仍握着水壶，朋友从画面右侧走进，手掌左右摆动，光从右肩上方落下。"], "机器人挥手"),
                         ["机器人一只手臂抬起，手挥动，另一只手仍握着水壶，朋友从画面右侧走进，手掌左右摆动，光从一侧肩膀上方落下。"])
        # A foot is no hand: "另一只脚" never comes without a first foot, and a bare limb that would read as another word
        # ("脚跟上" as a heel) keeps its count.
        self.assertEqual(drop_sides(["<Subject 1> 右手握枪，左手抱拳；<Subject 2> 右手握剑。<Subject 1> 与 <Subject 2> 左脚先迈出，右脚跟上"], "抱拳后并肩走"),
                         ["<Subject 1> 一只手握枪，另一只手抱拳；<Subject 2> 一只手握剑。<Subject 1> 与 <Subject 2> 一只脚先迈出，另一只脚跟上"])
        self.assertEqual(drop_sides(["左脚迈出，左脚跟上，右脚跟上"], "走"), ["一只脚迈出，同一只脚跟上，另一只脚跟上"])
        # A first side named again after the other one could be either: that pair keeps its sides, the rest still go.
        self.assertEqual(drop_sides(["左脚迈出，右脚跟上，左脚跟上"], "走"), ["左脚迈出，右脚跟上，左脚跟上"])
        self.assertEqual(drop_sides(["武士右手持剑，左手握拳。", "右手将剑向前刺出，右脚踏前。", "左手松开，右手收剑。"], "武士刺剑后收剑"),
                         ["武士右手持剑，左手握拳。", "右手将剑向前刺出，一只脚踏前。", "左手松开，右手收剑。"])
        self.assertEqual(drop_sides(["她右肩的背带滑落，左手抽出水壶"], "卸下背包"), ["她一侧肩膀的背带滑落，一只手抽出水壶"])
        self.assertEqual(drop_sides(["右手举刀，镜头向左摇"], "举刀劈砍"), ["一只手举刀，镜头向左摇"])
        self.assertEqual(drop_sides(["右手举刀"], "右手举刀向前劈砍"), ["右手举刀"])
        text = compile_action_phases(phases().replace("后腿蹬起，身体前倾", "身体向后仰，后腿蹬地"), "T2VA", 5, CAT)
        self.assertNotIn("后仰", text)
        self.assertIn("后腿用力一蹬，从窗台一跃而下", text)
        for rule in ("挥手就写挥手", "动作词原样写出来", "不加用户没写的准备动作", "用户没写左右就不写左右", "近景拍头部和肩膀", "特写拍脸或手等局部"):
            self.assertIn(rule, service.MINIMAX_H3_WRITER_RULES)

    def test_the_speaker_is_named_and_the_sounds_never_speak(self):
        source = base_source_view("<Picture 1> 抬手向镜头挥手并说：“出发吧。”")
        answer = ("概述：三维渲染，温室中铜绿机器人持洒水壶静立，镜头固定拍摄\n起始：机器人右臂缓慢抬起，挥手\n递进：手掌在胸前张开，说话\n"
                  "收束：手臂放下\n声音：金属关节轻微转动声，机器人说出“出发吧”\n约束：无")
        text = compile_action_phases(answer, "I2VA", 5, source)
        self.assertIn("机器人一只手臂缓慢抬起，挥手。手掌在胸前张开，电子音轻快的机器人 (S1) 说：<d>[Chinese] 出发吧。</d>手臂放下。", text)
        self.assertIn("overall_soundscape: 金属关节轻微转动声清晰可闻。\n", text)

    def test_a_requested_cut_in_first_last_frames_ends_in_the_last_frames_framing(self):
        request = service.build_minimax_h3_writer_request("女神转动权杖，第4秒切到近景", "", "FL2VA", 8, sees_frames=True, cut=True)
        self.assertIn("最后一个镜头结尾要回到 <Picture 2> 的景别和构图", request)
        self.assertNotIn("最后一个镜头结尾要回到", service.build_minimax_h3_writer_request("女神转动权杖，第4秒切到近景", "", "I2VA", 8, sees_frames=True, cut=True))

    def test_a_repeated_beat_and_an_unasked_shot_stay_in_the_shots_the_user_asked_for(self):
        from prompt_assistant.h3_prompt_enhance import asked_shots
        self.assertEqual([asked_shots(t) for t in ["第4秒切到近景", "分三个镜头", "第3秒切到近景，然后切到特写", "不要切镜头"]], [1, 2, 2, None])
        # The live answer wrote a second 收束 after 镜头2 and a 镜头3 that only pulls back to the last frame.
        answer = ("概述：动漫插画风格，女神闭眼坐在台阶上，橘猫坐在下方台阶，固定镜头\n起始：女神轻转权杖\n递进：光点流转，橘猫尾巴轻摆\n收束：权杖转到半圈\n"
                  "镜头2（第4秒）：切至近景，女神胸部以上，权杖继续转动，尾巴摆动收束\n收束：镜头在近景中保持，光点流转变慢，橘猫尾巴摆动收束\n"
                  "镜头3：拉远至与 <Picture 2> 相同的全景构图，权杖继续转动\n约束：无")
        text = compile_action_phases(answer, "FL2VA", 8, "女神轻轻转动权杖，光点流转，橘猫轻轻摆尾，第4秒切到近景", cut=True)
        self.assertIn("[Shot 1] 动漫插画风格，<Picture 1> 中的女神闭眼坐在台阶上，橘猫坐在下方台阶。固定镜头。女神轻转权杖。光点流转，橘猫尾巴轻摆。权杖转到半圈。\n"
                      "[Shot 2] At 00:04.000 镜头切至近景，女神胸部以上，权杖继续转动，尾巴摆动收束，镜头在近景中保持，光点流转变慢，镜头拉远至与 <Picture 2> 相同的全景构图。\n\n", text)
        # The cut's own second belongs to the shot mark; a frozen "画面保持原状" mid-action goes.
        timed = answer.replace("收束：权杖转到半圈", "收束：第4秒前，权杖转到半圈，画面保持原状").replace("镜头3：拉远", "镜头3：镜头在第4秒末缓慢拉远")
        text = compile_action_phases(timed, "FL2VA", 8, "女神轻轻转动权杖，光点流转，橘猫轻轻摆尾，第4秒切到近景", cut=True)
        self.assertIn("权杖转到半圈。\n[Shot 2] At 00:04.000", text)
        self.assertIn("，镜头缓慢拉远至与 <Picture 2> 相同的全景构图。", text)

    def test_the_translation_keeps_the_official_shot_sizes_and_anchor_english(self):
        from prompt_assistant.h3_prompt_enhance import translation_flips, PROGRAM_SENTENCES
        self.assertEqual(translation_flips("镜头切到近景", "The camera cuts to a close-up."), ["近景 means medium close-up"])
        self.assertEqual(translation_flips("镜头切到近景", "The camera cuts to a medium close-up."), [])
        self.assertEqual(translation_flips("远景中女孩奔跑", "A full shot of the girl running."), ["远景 means wide shot"])
        # A spear's parts in a chunk without its scene came back as a gun; "松开枪柄" holds no 开枪, a pistol is a gun.
        self.assertEqual(translation_flips("左手松开枪柄，枪尖轻触地面", "The left hand releases the gun grip."), ["枪 here is a spear, never a gun"])
        self.assertEqual(translation_flips("警察拔出手枪，枪口对准前方", "The officer draws his gun."), [])
        self.assertEqual(translation_flips("警察迅速出枪，对准歹徒。", "The officer quickly draws his gun and aims at the suspect."), [])
        self.assertEqual(translation_flips("他枪法精准，连开三枪。", "His marksmanship is precise; he fires his gun three times."), [])
        self.assertEqual(PROGRAM_SENTENCES["画面从 <Picture 1> 的位置与构图开始。"], "The shot begins in the position and framing established by <Picture 1>.")

    def test_the_english_copy_is_put_in_the_official_form(self):
        from prompt_assistant.h3_prompt_enhance import official_english
        # "第3秒" came back as "the 3nd second"; the style words stand before the subject with a comma; a cut has its camera.
        self.assertEqual(official_english("summary: at the 3nd second, cut to a medium close-up."), "summary: at the 3rd second, cut to a medium close-up.")
        self.assertEqual(official_english("[Shot 1] Live-action, cinematic; a ginger cat sits on the sill."), "[Shot 1] Live-action, cinematic, a ginger cat sits on the sill.")
        self.assertEqual(official_english("[Shot 1] Live-action, cinematic style. A long-haired cat sits."), "[Shot 1] Live-action, cinematic, a long-haired cat sits.")
        self.assertEqual(official_english("[Shot 1] 3D CG. Picture 1 shows her."), "[Shot 1] 3D CG, Picture 1 shows her.")
        # A first sentence with its own content is not a style label.
        self.assertEqual(official_english("[Shot 1] 3D CG, the robot waves. It smiles."), "[Shot 1] 3D CG, the robot waves. It smiles.")
        self.assertEqual(official_english("[Shot 2] At 00:03.000, cut to a medium close-up"), "[Shot 2] At 00:03.000, the camera cuts to a medium close-up")
        # A definition is a noun phrase; a name stays as it is; spoken words are never touched.
        self.assertEqual(official_english("subject_definitions:\n<Subject 1>: Male character, short black hair.\n<Subject 2>: Erlang Shen, a god."),
                         "subject_definitions:\n<Subject 1>: a male character, short black hair.\n<Subject 2>: Erlang Shen, a god.")
        self.assertEqual(official_english("She says: <d>[English] the 3nd</d>"), "She says: <d>[English] the 3nd</d>")
        # A name keeps its capital and takes no article ("Nezha", "Zhong Kui"); a common word is lowered.
        self.assertEqual(official_english("<Subject 1>: Nezha in <Picture 1>, with a red sash\n[Shot 1] 3D CG. Zhong Kui glares ahead. The goddess sits."),
                         "<Subject 1>: Nezha in <Picture 1>, with a red sash\n[Shot 1] 3D CG, Zhong Kui glares ahead. The goddess sits.")
        self.assertEqual(official_english("[Shot 1] Anime style. <Subject 1> runs.", opening_style=False), "[Shot 1] Anime style. <Subject 1> runs.")
        # A tag that opens its sentence with a description after it is the subject, not a place or a noun's name.
        self.assertEqual(official_english("The background is white. At <Subject 1>, a man with black hair, stands still. The character <Subject 2> bows.", opening_style=False),
                         "The background is white. <Subject 1>, a man with black hair, stands still. <Subject 2> bows.")
        # A bearded man is "he" in every chunk; a clause about a man and a woman, or about nobody named, is left alone.
        from prompt_assistant.h3_prompt_enhance import subject_pronouns
        definitions = ("subject_definitions:\n<Subject 1>: <Picture 1> 中的男性角色\n<Subject 2>: <Picture 2> 中的男子，胡须\n<Subject 3>: <Picture 3> 中的女子\n\n"
                       "retention_analysis:\n<Subject 1>: fully_preserved - 黑发\n<Subject 2>: fully_preserved - 胡须")
        self.assertEqual(subject_pronouns("<Subject 2> turns her body, her beard trembling; <Subject 1> stops before <Subject 2>, who stares at her. She smiles. "
                                          "<Subject 3> raises his hand. <Subject 1> meets <Subject 3>, her hand up. (S1) says: <d>[English] her book</d>", definitions),
                         "<Subject 2> turns his body, his beard trembling; <Subject 1> stops before <Subject 2>, who stares at him. She smiles. "
                         "<Subject 3> raises her hand. <Subject 1> meets <Subject 3>, her hand up. (S1) says: <d>[English] her book</d>")
        # A robot and a cat without a sex are "it".
        pets = "subject_definitions:\n<Subject 1>: <Picture 1> 中的机器人，头部呈圆顶状\n<Subject 2>: <Picture 2> 中的橘猫\n<Subject 3>: <Picture 3> 中的女子"
        self.assertEqual(subject_pronouns("<Subject 1> strokes <Subject 2> with her left hand; <Subject 2> lowers his head toward her. "
                                          "<Subject 1> looks at <Subject 3>, her hand up.", pets),
                         "<Subject 1> strokes <Subject 2> with its left hand; <Subject 2> lowers its head toward it. "
                         "<Subject 1> looks at <Subject 3>, her hand up.")
        # "her" before an adverb, a particle or the verb it is made to do is the object; only a head noun makes an "it".
        for english, expected in [("<Subject 1> lifts <Subject 2> and holds her close.", "<Subject 1> lifts <Subject 2> and holds it close."),
                                  ("<Subject 1> strokes <Subject 2>, making her purr softly.", "<Subject 1> strokes <Subject 2>, making it purr softly."),
                                  ("<Subject 1> strokes <Subject 2> gently; <Subject 2> lifts her up gently.", "<Subject 1> strokes <Subject 2> gently; <Subject 2> lifts it up gently."),
                                  ("<Subject 2> flicks her tail; <Subject 1> rubs her belly.", "<Subject 2> flicks its tail; <Subject 1> rubs its belly.")]:
            self.assertEqual(subject_pronouns(english, pets), expected)
        armoured = "subject_definitions:\n<Subject 1>: <Picture 1> 中的战士，身穿机械铠甲，手持长剑\n<Subject 2>: <Picture 2> 中的角色，身穿龙纹长袍，骑着白马"
        self.assertEqual(subject_pronouns("<Subject 1> raises his sword. <Subject 2> bows his head.", armoured), "<Subject 1> raises his sword. <Subject 2> bows his head.")
        # The first word of a longer name keeps its capital though the text writes it in lower case elsewhere.
        self.assertEqual(official_english("[Shot 1] 3D CG. Sun Wukong leaps onto the cloud as the sun rises."), "[Shot 1] 3D CG, Sun Wukong leaps onto the cloud as the sun rises.")
        self.assertEqual(official_english("[Shot 1] 3D CG. Jade Emperor sits on a jade throne."), "[Shot 1] 3D CG, Jade Emperor sits on a jade throne.")
        self.assertEqual(official_english("[Shot 1] 3D CG. The Monkey King leaps."), "[Shot 1] 3D CG, the Monkey King leaps.")

    def test_a_pair_the_translator_folds_into_the_two_is_put_back(self):
        # "TOKEN_0 与 TOKEN_1 面对面抱拳行礼" came back as "The two face each other ..." on every attempt.
        fields = ("subject_definitions:\n<Subject 1>: <Picture 1> 中的男子\n<Subject 2>: <Picture 2> 中的男子\n\nsummary:\n[reference generation] "
                  "<Subject 1> 与 <Subject 2> 面对面抱拳行礼。\n\nretention_analysis:\n<Subject 1>: fully_preserved - 男子\n<Subject 2>: fully_preserved - 男子\n\n"
                  "detailed_description:\n[Shot 1] <Subject 1> 与 <Subject 2> 面对面抱拳行礼。\n\noverall_soundscape:\n风声。\n\nnon_diegetic_music:\nN/A")
        assistant = service.PromptAssistant()

        def generate(prompt, **kwargs):
            pending = json.loads(prompt.split("Input JSON:\n", 1)[1])
            english = {"TOKEN_0 中的男子": "the man in TOKEN_0", "TOKEN_0 与 TOKEN_1 面对面抱拳行礼。": "The two figures face each other and salute with clasped fists.",
                       "男子": "The man", "风声。": "Wind blows."}
            return json.dumps({key: english[value] for key, value in pending.items()})
        assistant.generate = generate
        pair = json.loads(assistant.translate_h3_reference(fields, "Available resource labels: <Picture 1>; <Picture 2>", 5)["positivePrompt"])
        self.assertIn("[Shot 1] <Subject 1> and <Subject 2> face each other and salute with clasped fists.", pair["modelPrompt"])
        self.assertIn("<Subject 1>: the man in <Picture 1>", pair["modelPrompt"])

    def test_a_complete_translation_is_kept_when_every_retry_drops_a_placeholder(self):
        fields = ("integrated_multimodal_description: [Shot 1] 写实电影风格，<Picture 1> 中的光点流转速度缓慢加快。\n"
                  "[Shot 2] At 00:03.000 镜头切到近景，女孩走向镜头。\n\noverall_soundscape: 风声。\n\nnon_diegetic_music: N/A")
        answers = iter([{"0": "Live-action, cinematic, the light points in TOKEN_0 flow and gradually slow down.",
                         "1": "The camera cuts to a close-up as the girl walks toward the camera.", "2": "Wind blows."},
                        {"0": "The light points flow and speed up."}, {"0": "The light points flow faster."}])
        assistant, requests = service.PromptAssistant(), []

        def generate(prompt, **kwargs):
            pending = json.loads(prompt.split("Input JSON:\n", 1)[1])
            requests.append(pending)
            return json.dumps({key: value for key, value in next(answers).items() if key in pending})
        assistant.generate = generate
        pair = json.loads(assistant.translate_h3_base(fields, "I2VA", 5)["positivePrompt"])
        # 近景 is written as the official medium close-up without asking again; the retries lost <Picture 1>, so the
        # first complete answer stands instead of failing the whole compile, with its reversed speed turned back.
        self.assertEqual([list(r) for r in requests], [["0", "1", "2"], ["0"], ["0"]])
        self.assertIn("the light points in <Picture 1> flow and gradually speed up.", pair["modelPrompt"])
        self.assertNotIn("slow down", pair["modelPrompt"])
        # Only a reversal that can be turned back word for word is; a camera pushed in for 拉远 is not shipped.
        from prompt_assistant.h3_prompt_enhance import unflip
        self.assertEqual(unflip("金币消失后，TOKEN_0 向右转身。", "After the coin vanishes, TOKEN_0 turns to the left."), "After the coin vanishes, TOKEN_0 turns to the right.")
        self.assertEqual(unflip("镜头缓慢拉远。", "The camera pushes in at slow speed."), "")
        self.assertIn("cuts to a medium close-up as the girl walks", pair["modelPrompt"])
        # Whole phrases turn back ("slowed down" is "sped up", never "slowed up"); a camera's up or down only in its own clause.
        self.assertEqual(unflip("光点缓慢流动，然后逐渐加快。", "The flow slowed down."), "The flow sped up.")
        self.assertEqual(unflip("她跑得很快，随后逐渐放慢脚步。", "She runs fast, then speeding up her pace."), "She runs fast, then slowing down her pace.")
        self.assertEqual(unflip("镜头缓缓上摇，女孩弯腰放下水壶。", "The camera slowly tilts down while the girl bends down to put the kettle down."),
                         "The camera slowly tilts up while the girl bends down to put the kettle down.")

    def test_the_last_sampled_translation_ships_as_it_came(self):
        # "缓慢行走" is no 放慢, so a right "walks slower" is read as a reversal; the last answer is not turned around.
        fields = "integrated_multimodal_description: [Shot 1] 她先缓慢行走，然后加快脚步。\n\noverall_soundscape: 风声。\n\nnon_diegetic_music: N/A"
        english = {"她先缓慢行走，然后加快脚步。": "She walks slower at first, then quickens her pace.", "风声。": "Wind blows."}
        assistant, requests = service.PromptAssistant(), []

        def generate(prompt, **kwargs):
            pending = json.loads(prompt.split("Input JSON:\n", 1)[1])
            requests.append(pending)
            return json.dumps({key: english[value] for key, value in pending.items()})
        assistant.generate = generate
        pair = json.loads(assistant.translate_h3_base(fields, "T2VA", 5)["positivePrompt"])
        self.assertEqual(len(requests), 3)
        self.assertIn("She walks slower at first, then quickens her pace.", pair["modelPrompt"])

    def test_a_long_shot_is_translated_a_few_sentences_at_a_time(self):
        # A placeholder dropped in one part of a long shot costs one short retry, not the whole shot again.
        sentence = "女孩在花园里慢慢走向秋千，裙摆随风轻轻摆动，阳光透过树叶洒在小路上，远处传来鸟鸣声和树叶的沙沙声。"
        fields = ("integrated_multimodal_description: [Shot 1] " + sentence * 4 + "女孩说：<d>[Chinese] 你好。</d>\n\n"
                  "overall_soundscape: 风声。\n\nnon_diegetic_music: N/A")
        assistant, requests = service.PromptAssistant(), []

        def generate(prompt, **kwargs):
            pending = json.loads(prompt.split("Input JSON:\n", 1)[1])
            requests.append(pending)
            answer = {}
            for key, value in pending.items():
                english = "The girl walks slowly toward the swing in the garden. " * value.count("女孩在花园") if value != "风声。" else "Wind blows."
                answer[key] = english + (" The girl says: TOKEN_0" if "TOKEN_0" in value and len(requests) > 1 else "")
            return json.dumps(answer)
        assistant.generate = generate
        pair = json.loads(assistant.translate_h3_base(fields, "T2VA", 5)["positivePrompt"])
        self.assertGreater(len(requests[0]), 2)
        # Only the part with the spoken line was asked again.
        self.assertEqual(len(requests), 2)
        self.assertEqual(len(requests[1]), 1)
        self.assertIn("<d>[Chinese] 你好。</d>", pair["modelPrompt"])
        self.assertEqual(pair["modelPrompt"].count("The girl walks slowly toward the swing in the garden."), 4)

    def test_reference_retention_says_where_each_item_appears_and_sounds_are_concrete(self):
        from prompt_assistant.h3_prompt_enhance import retention_appearances, action_sounds
        text = ("subject_definitions:\n<Subject 1>: A girl. Source: <Picture 1>.\n<Subject 2>: A robot. Source: <Picture 2>.\n\nsummary:\n[reference generation] x\n\n"
                "retention_analysis:\n<Subject 1>: fully_preserved - hair\n<Subject 2>: fully_preserved - body\n\n"
                "detailed_description:\nAnime style.\n[Shot 1] <Subject 1> walks to <Subject 2>.\n[Shot 2] At 00:03.000, the camera cuts to <Subject 2>.\n\n"
                "overall_soundscape:\nSteps.\n\nnon_diegetic_music:\nN/A")
        marked = retention_appearances(text)
        self.assertIn("<Subject 1> (appears in [Shot 1]): fully_preserved - hair\n<Subject 2> (appears in [Shot 1], [Shot 2]): fully_preserved - body", marked)
        self.assertEqual(validate_reference(marked, "Available resource labels: <Picture 1>; <Picture 2>", 5), marked)
        self.assertEqual(action_sounds("<Subject 1> 从远处缓步走向 <Subject 2>，金色铠甲，手持长枪"), "脚步声伴着甲片碰撞声和兵器的金属轻响。")
        self.assertNotEqual(action_sounds("<Subject 1> 坐着"), "与画面动作一致的自然环境声和动作声。")
        # Whole words of the scene and actions: the style sentence is no wind, a subject's nails no armour.
        self.assertEqual(action_sounds("视频采用写实电影风格。\n[Shot 1] 场景是温室。<Subject 1> 走向 <Subject 2>。"), "脚步声清晰可闻。")
        self.assertEqual(action_sounds("[Shot 1] 场景是咖啡馆，<Subject 1> 涂着红色指甲，坐着端起杯子"), "动作带起轻微的衣料摩擦声。")
        # The shot's own sounds come first, in their order; a robot and a cat wear no cloth.
        self.assertEqual(action_sounds("[Shot 1] <Subject 1> 手指轻按，铜色关节发出轻微“咔哒”轻响；<Subject 2> 蹭出“呼噜”声，无声凝视。", clothed=False),
                         "铜色关节发出轻微咔哒轻响，蹭出呼噜声。")
        self.assertEqual(action_sounds("[Shot 1] <Subject 1> 缓步走来，甲片摩擦发出锵锵轻响"), "甲片摩擦发出锵锵轻响，伴随着脚步声。")
        self.assertEqual(action_sounds("[Shot 1] <Subject 1> 坐着", clothed=False), "动作带起轻微的声响。")

    def test_a_reference_video_without_a_sound_line_hears_its_scene_and_actions(self):
        plan = {"references": [{"label": "<Subject 1>", "sources": ["<Picture 1>"], "description": "铜绿色机器人，手持金属洒水壶，涂着红色指甲", "keep": "外观不变"}],
                "tasks": ["reference generation"], "summary": "<Subject 1> 走向花坛。", "description": "<Subject 1> 走向花坛。", "soundscape": "N/A", "music": "N/A"}
        written = dict(plan, description="视频采用写实电影风格。\n[Shot 1] 场景是温室。<Subject 1> 走向花坛。镜头固定。")
        captured, assistant = [], service.PromptAssistant()
        assistant.generate = lambda prompt, **kwargs: json.dumps(plan, ensure_ascii=False)

        def translate(positive, *args):
            captured.append(positive)
            raise RuntimeError("translated")
        with mock.patch.object(service.PromptAssistant, "route_h3_reference_sources", return_value=(None, None)), \
                mock.patch.object(service.PromptAssistant, "write_h3_reference_scene", return_value=written), \
                mock.patch.object(service.PromptAssistant, "translate_h3_reference", side_effect=translate):
            with self.assertRaisesRegex(RuntimeError, "translated"):
                assistant._optimize_h3_reference("<Picture 1> 的机器人走向花坛", "Available resource labels: <Picture 1>\nSource prompt:\n<Picture 1> 的机器人走向花坛", 5)
        # Its steps, not the style sentence's "风格" (wind) or the subject's nails (armour).
        self.assertIn("overall_soundscape:\n脚步声清晰可闻。", captured[0])

    def test_the_picture_sets_the_opening_framing_and_the_writer_adds_no_measures(self):
        answer = ("概述：三维渲染，温室中铜绿机器人持洒水壶站立，中景，镜头固定拍摄\n起始：机器人抬起一只手\n递进：这只手向镜头挥动\n"
                  "收束：洒水壶停在镜头前约10厘米处\n约束：无")
        text = compile_action_phases(answer, "I2VA", 5, "机器人抬手向镜头挥手")
        self.assertIn("[Shot 1] 三维渲染，温室中铜绿机器人持洒水壶站立。镜头固定拍摄。画面从 <Picture 1> 的位置与构图开始。", text)
        # One look: "三维渲染动漫插画" keeps the first.
        self.assertIn("[Shot 1] 三维渲染，温室中", compile_action_phases(answer.replace("三维渲染，", "三维渲染动漫插画，"), "I2VA", 5, "机器人抬手向镜头挥手"))
        self.assertIn("洒水壶停在镜头前。", text)
        # An angle the writer gives leaves no "形成角": that clause goes, and so does a note that the action is not done;
        # the writer's own demonstrative ("这只手") leaves the limb alone.
        angled = compile_action_phases(answer.replace("洒水壶停在镜头前约10厘米处", "权杖旋转至与初始位置形成约15度角，动作未完成"), "I2VA", 5, "机器人抬手向镜头挥手")
        self.assertIn("机器人抬起一只手。手向镜头挥动。", angled)
        self.assertNotRegex(angled, "形成|未完成|这只")
        # The user's own size and measure stay; a text video keeps the size its writer is asked for.
        self.assertIn("中景", compile_action_phases(answer, "I2VA", 5, "中景，机器人抬手向镜头挥手"))
        self.assertIn("约10厘米", compile_action_phases(answer, "I2VA", 5, "机器人把洒水壶举到镜头前约10厘米处"))
        self.assertIn("中景", compile_action_phases(answer, "T2VA", 5, "机器人抬手向镜头挥手"))
        # A size the user asks for after a cut is that shot's, not the opening's.
        cut = answer.replace("约束：无", "镜头2（第3秒）：切到近景，机器人继续挥手\n约束：无")
        self.assertNotIn("中景", compile_action_phases(cut, "I2VA", 5, "机器人抬手向镜头挥手，第3秒切到中景", cut=True).split("[Shot 2]")[0])
        from prompt_assistant.h3_prompt_enhance import picture_subject, size_first
        # Weather, light or a camera move before the subject is no subject: the subject the first frame shows is.
        self.assertEqual(picture_subject("三维渲染，微风轻拂，女神闭眼静坐于台阶上"), "三维渲染，微风轻拂，<Picture 1> 中的女神闭眼静坐于台阶上")
        self.assertEqual(picture_subject("写实电影风格，雨夜，她撑伞站在街头"), "写实电影风格，雨夜，她撑伞站在街头")
        # Moving scenery before the subject is no subject either; alone it is.
        for opening, subject in [("三维渲染，微风轻拂，花瓣飘落，女神闭眼静坐于台阶上", "女神"), ("动漫插画，樱花飘落，少女站在树下", "少女"),
                                 ("写实电影风格，海浪拍岸，女子站在礁石上", "女子"), ("写实电影风格，街道两旁灯火通明，女子撑伞走来", "女子"),
                                 ("写实电影风格，海浪拍打礁石，镜头固定", "海浪")]:
            self.assertIn("<Picture 1> 中的" + subject, picture_subject(opening))
        # Only a size that opens its clause or that the camera films moves; a view of the city stays; clauses stay apart.
        self.assertEqual(size_first("写实电影风格，全景镜头下，一只橘猫趴在窗台上，镜头固定"), "写实电影风格，全景，一只橘猫趴在窗台上，镜头固定")
        for view in ("写实电影风格，一只橘猫趴在窗台上的全景画面，镜头固定", "写实电影风格，女孩站在天台上，身后是城市的全景，镜头固定"):
            self.assertEqual(size_first(view), view)
        # A quoted line is the user's word for word, 太极 keeps its 极, and "几乎看不见的" goes with its 、.
        calm = compile_action_phases("概述：写实电影风格，老人站在公园里，镜头固定\n起始：老人打起太极轻推双掌\n递进：掌心画出连续的、几乎看不见的弧线\n"
                                     "收束：老人说：“这只手好累。”\n约束：无", "T2VA", 5, "老人打太极，说：“这只手好累。”")
        self.assertIn("老人打起太极轻推双掌。掌心画出连续的弧线。老人说：“这只手好累。”", calm)
        # "几乎察觉不到地" goes with its 地, and 并且 keeps its 且.
        calm = compile_action_phases("概述：写实电影风格，老人站在公园里，镜头固定\n起始：老人打起太极，身体几乎察觉不到地微微晃动\n"
                                     "递进：双掌缓慢推出，并且几乎看不见地调整重心\n收束：老人收势站定\n约束：无", "T2VA", 5, "老人打太极")
        self.assertIn("老人打起太极，身体微微晃动。双掌缓慢推出，并且调整重心。", calm)

    def test_a_cut_keeps_the_users_shots_and_the_state_the_user_holds(self):
        from prompt_assistant.h3_prompt_enhance import asked_shots
        # A third shot asked for without "切" stays its own shot, with its size.
        answer = ("概述：写实电影风格，女孩在街上散步，镜头跟随\n起始：女孩向前走\n递进：女孩继续向前走\n收束：女孩放慢脚步\n"
                  "镜头2（第3秒）：切到近景，女孩转头望向镜头\n镜头3（第6秒）：切到特写，女孩的脸上露出笑容\n约束：无")
        words = "女孩在街上散步，第3秒切到近景，最后给一个她笑脸的特写镜头"
        self.assertEqual(asked_shots(words), 1)
        text = compile_action_phases(answer, "T2VA", 8, words, cut=True)
        self.assertIn("\n[Shot 3] At 00:06.000 镜头切到特写，女孩的脸上露出笑容。", text)
        # "闭着眼睛" holds in every shot that shows her, written as the state, not as a note that it lasts; the opening
        # already shows it; the writer's own "坐姿全程保持" does not stay.
        goddess = ("概述：动漫插画风格，女神闭眼坐在台阶上手持权杖，橘猫坐在下方台阶，固定镜头\n起始：女神轻转权杖\n递进：光点流转，橘猫尾巴轻摆\n"
                   "收束：权杖转到半圈\n镜头2（第4秒）：切到女神的近景，女神继续转动权杖\n约束：1. 女神闭眼全程保持\n2. 橘猫坐姿全程保持")
        text = compile_action_phases(goddess, "FL2VA", 8, "女神闭着眼睛轻轻转动手中的权杖，台阶上的橘猫轻轻摆尾，第4秒切到近景", cut=True)
        self.assertIn("[Shot 1] 动漫插画风格，<Picture 1> 中的女神闭眼坐在台阶上手持权杖，橘猫坐在下方台阶。固定镜头。女神轻转权杖。", text)
        # The held state comes right after the cut's framing, before the shot's action.
        self.assertIn("[Shot 2] At 00:04.000 镜头切到女神的近景，女神依旧闭眼，女神继续转动权杖。", text)
        self.assertNotIn("全程", text)
        self.assertNotIn("坐姿全程保持", text)
        # The writer is told a close shot frames one subject.
        request = service.build_minimax_h3_writer_request("女神转动权杖，橘猫摆尾，第4秒切到近景", "", "FL2VA", 8, sees_frames=True, cut=True)
        self.assertIn("近景或特写只拍一个主体，写明拍的是谁，其他主体的动作写在切换之前", request)
        # A close shot that still names both keeps the first: the cat's tail was told before the cut, word for word again.
        both = goddess.replace("切到女神的近景，女神继续转动权杖", "切近景，镜头聚焦于女神与橘猫，女神继续转动权杖，橘猫尾巴轻摆，毛发随风轻扬，镜头最后缓慢拉远")
        text = compile_action_phases(both, "FL2VA", 8, "女神闭着眼睛轻轻转动手中的权杖，台阶上的橘猫轻轻摆尾，第4秒切到近景", cut=True)
        self.assertIn("[Shot 2] At 00:04.000 镜头切近景，镜头聚焦于女神，女神依旧闭眼，女神继续转动权杖，镜头最后缓慢拉远。", text)
        # The writer's note on the held state ("女神位置、闭眼状态保持图中") is no sentence of the video: the shot already shows
        # it, and after the cut it is carried in the user's words; "橘猫静坐阶下" names the cat that leaves the close shot.
        noted = ("概述：三维渲染，女神闭目坐于神殿台阶，手持权杖，橘猫静坐阶下，暮色中光点流转，固定镜头\n起始：女神闭着眼睛，指尖轻旋权杖\n"
                 "递进：权杖在她掌心缓缓转出半圈，橘猫尾尖轻颤\n收束：权杖转至半圈\n"
                 "镜头2（第4秒）：切近景，镜头聚焦于女神与权杖，光点在她身侧流转，橘猫尾尖轻摆，镜头最后缓慢拉远到 <Picture 2> 的构图\n约束：1. 女神位置、闭眼状态保持图中")
        text = compile_action_phases(noted, "FL2VA", 8, "女神闭着眼睛轻轻转动手中的权杖，台阶上的橘猫轻轻摆尾，第4秒切到近景", cut=True)
        self.assertIn("固定镜头。女神闭着眼睛，指尖轻旋权杖。", text)
        self.assertIn("[Shot 2] At 00:04.000 镜头切近景，镜头聚焦于女神与权杖，女神依旧闭眼，光点在她身侧流转，镜头最后缓慢拉远到 <Picture 2> 的构图。", text)
        self.assertNotIn("保持图中", text)
        # The user's own two-subject close shot stays.
        text = compile_action_phases(both, "FL2VA", 8, "女神闭着眼睛轻轻转动手中的权杖，台阶上的橘猫轻轻摆尾，第4秒切到女神和橘猫的近景", cut=True)
        self.assertIn("镜头聚焦于女神与橘猫", text)

    def test_what_a_beat_puts_down_is_not_held_and_a_drinking_mouth_does_not_speak(self):
        # "她把背包从肩上卸下来…" ended "背包靠在她左肩，水壶仍握在左手"; "壶嘴凑到嘴边" and "嘴角上扬" became "继续说话";
        # the line had no speaker; "女孩" named an age the user never gave; "准备蹲下" only got ready.
        answer = ("概述：动漫插画，一位背着绿色背包的女孩站在乡间公路中央，镜头固定拍摄。\n"
                  "起始：她缓慢地将右肩的背包带向后拉，左肩的背带也顺势滑落，背包从双肩卸下，准备蹲下。\n"
                  "递进：她顺势蹲下，左手从背包侧袋抽出水壶，将壶嘴凑到嘴边，小口啜饮，随后将水壶放回原位，站直身体，抬头时嘴角上扬，露出温和的笑容。\n"
                  "收束：她直立在路中央，背包靠在她左肩，水壶仍握在左手，望向远方。\n约束：无")
        source = base_source_view("<Picture 1> 她把背包从肩上卸下来，蹲下拿出水壶喝了一口，然后抬头笑着说：“还有五公里。”")
        text = compile_action_phases(answer, "I2VA", 6, source)
        self.assertIn("[Shot 1] 动漫插画，<Picture 1> 中背着绿色背包的女子站在乡间公路中央。", text)
        self.assertIn("背包从双肩卸下。她顺势蹲下，一只手从背包侧袋抽出水壶，将壶嘴凑到嘴边，小口啜饮，随后将水壶放回原位，站直身体，抬头时嘴角上扬，露出温和的笑容。"
                      "声音清亮的女子 (S1) 说：<d>[Chinese] 还有五公里。</d>她直立在路中央，望向远方。", text)
        self.assertNotRegex(text, "准备|继续说话|仍握|靠在")
        # The user's own 女孩 stays; a child the user names (女童, 孩子, 七岁) is never made an adult, nor is the writer's 小女孩.
        self.assertIn("声音清亮的女孩 (S1) 说：", compile_action_phases(answer, "I2VA", 6, source.replace("她把", "女孩把")))
        little = answer.replace("一位背着绿色背包的女孩", "一个背着绿色背包的小女孩")
        for words in ["女童把", "孩子把", "七岁的孩子把", "她把"]:
            with self.subTest(words=words):
                self.assertIn("背着绿色背包的小女孩站在乡间公路中央", compile_action_phases(little, "I2VA", 6, source.replace("她把", words)))
        self.assertIn("背着绿色背包的女孩站在乡间公路中央", compile_action_phases(answer, "I2VA", 6, source.replace("她把", "女童把")))
        # "抬头笑着说" written as "头部向上抬起，嘴角上扬" keeps its actions: no second call for it.
        reworded = answer.replace("抬头时嘴角上扬", "头部向上抬起，嘴角上扬")
        result, calls = H3BaseLocalTest.run_local(self, [reworded], {"h3Mode": "image_video", "currentPrompt": "<Picture 1> 她把背包从肩上卸下来，蹲下拿出水壶喝了一口，然后抬头笑着说：“还有五公里。”"})
        self.assertEqual(len(calls), 1)
        self.assertIn("头部向上抬起，嘴角上扬", result["positivePrompt"])
        # The ending holds what the user keeps, not what the user puts down.
        held = service.build_minimax_h3_writer_request("<Picture 1> 机器人抬手挥手", "", "I2VA", 5, sees_frames=True)
        self.assertIn("图中拿着的东西继续拿着", held)
        self.assertNotIn("拿着的东西继续拿着", service.build_minimax_h3_writer_request(source, "", "I2VA", 6, sees_frames=True))
        self.assertIn("不写女孩、男孩、少女、少年", service.MINIMAX_H3_WRITER_RULES)
        # A jump down lands below; a first/last-frame opening names the pictures' scene and light.
        jump = service.build_minimax_h3_writer_request("一只橘猫在窗台上伸懒腰，然后跳下窗台", "", "T2VA", 5)
        self.assertIn("“跳下窗台”：原样写出“跳下窗台”，写清落在窗台下方的什么地方（如地板上），最后停在窗台下面，不再回到窗台上。", jump)
        self.assertIn("用一句话写图中的场景和光线", service.build_minimax_h3_writer_request("女神转动权杖", "", "FL2VA", 6, sees_frames=True))

    def test_beats_written_once_per_point_merge_into_one_set(self):
        answer = ("概述：三维渲染，女神闭眼坐于台阶，手持权杖，橘猫坐于下方台阶，固定镜头\n\n1. 女神闭着眼睛轻轻转动手中的权杖：\n起始：女神手腕轻转\n"
                  "递进：权杖持续转动\n收束：权杖停住\n\n2. 台阶上的橘猫轻轻摆尾：\n起始：橘猫尾尖抬起\n递进：尾巴摆动\n收束：尾巴垂下\n\n"
                  "镜头2（第4秒）：切到女神的近景，女神继续转动权杖\n\n声音：权杖轻响")
        text = compile_action_phases(answer, "FL2VA", 8, "女神闭着眼睛轻轻转动手中的权杖，台阶上的橘猫轻轻摆尾，第4秒切到近景", cut=True)
        self.assertIn("<Picture 1> 中的女神闭眼坐于台阶，手持权杖，橘猫坐于下方台阶。固定镜头。女神手腕轻转。橘猫尾尖抬起。权杖持续转动。尾巴摆动。权杖停住。尾巴垂下。\n[Shot 2]", text)
        self.assertNotRegex(text, "起始|递进|收束|1\\.|2\\.")
        # Two steps in three beats: a missing second step opens the last beat.
        from prompt_assistant.h3_prompt_enhance import write_missing_actions
        self.assertEqual(write_missing_actions(["橘猫舒展身体。", "橘猫前爪伸直。", "橘猫落在地上。"], "橘猫伸懒腰，然后跳进纸箱", "", "橘猫"),
                         ["橘猫舒展身体。", "橘猫前爪伸直。", "橘猫跳进纸箱，落在地上。"])

    def test_the_request_says_how_the_pose_changes_and_how_the_speaker_sounds(self):
        request = service.build_minimax_h3_writer_request("橘猫打了个哈欠，然后慢慢趴下", "", "I2VA", 5, sees_frames=True)
        self.assertIn("趴下或躺下从图中的姿态开始，写清身体先动哪里（坐着的动物是前爪向前滑出，身体随之放低）。", request)
        self.assertNotIn("前爪向前滑出", service.build_minimax_h3_writer_request("橘猫打了个哈欠", "", "I2VA", 5, sees_frames=True))
        # After a jump it lies down where it landed, not from the picture's pose.
        self.assertNotIn("前爪向前滑出", service.build_minimax_h3_writer_request("橘猫跳上旁边的椅子，然后趴下", "", "I2VA", 5, sees_frames=True))
        self.assertNotIn("侧对或背对", service.build_minimax_h3_writer_request("猫咪跳上桌子后看镜头", "", "I2VA", 5, sees_frames=True))
        spoken = service.build_minimax_h3_writer_request("机器人挥手并说", "", "I2VA", 5, sees_frames=True, dialogue_lines=['(S1)："出发吧。"'])
        self.assertIn("说话的句子写成“说话者用什么样的声音开口说”", spoken)

    def test_a_romanized_leftover_is_asked_again_with_its_sentence(self):
        from prompt_assistant.h3_prompt_enhance import pinyin_like
        self.assertTrue(pinyin_like("Kuokou", "壶口"))
        self.assertFalse(pinyin_like("spout", "壶口"))
        self.assertFalse(pinyin_like("banana", "香蕉"))
        self.assertIn("动漫插画 or 二维动画 -> 2D-animated", (ROOT / "prompt-assistant-service.py").read_text(encoding="utf-8-sig"))

    def test_a_retry_that_fixes_nothing_keeps_the_first_answer_unless_it_sets_up_the_thing(self):
        words = {"h3Mode": "image_video", "currentPrompt": "猫咪跳上桌子"}
        first = "概述：写实电影风格，橘猫端坐在灰色背景前，镜头固定\n起始：橘猫后腿发力\n递进：橘猫跃起\n收束：橘猫落在桌面上\n约束：无"
        same = first.replace("橘猫后腿发力", "橘猫后腿用力一蹬")
        result, calls = H3BaseLocalTest.run_local(self, [first, same], words)
        self.assertEqual([kwargs["trace_label"] for _, kwargs in calls], ["minimaxH3PromptEnhance", "minimaxH3PromptRepair"])
        self.assertIn("“桌子”要在用到它之前出现", calls[1][0])
        # The retry fixed nothing: the first answer, with the jump going to the table.
        self.assertIn("橘猫后腿发力。橘猫朝桌子跃起。橘猫落在桌面上。", result["positivePrompt"])
        # A retry that names the table on the way to it is kept.
        fixed = first.replace("橘猫跃起", "橘猫朝画面前方的桌子跃起")
        result, _ = H3BaseLocalTest.run_local(self, [first, fixed], words)
        self.assertIn("橘猫朝画面前方的桌子跃起。橘猫落在桌面上。", result["positivePrompt"])
        # On a tie (one problem each) the retry that sets the table up wins.
        late = "概述：写实电影风格，橘猫端坐在灰色背景前，镜头固定\n起始：橘猫后腿发力\n递进：橘猫跃起\n收束：橘猫落在桌面上，回头看向镜头\n约束：无"
        early = ("概述：写实电影风格，橘猫端坐在灰色背景前，画面前方放着一张木桌，镜头固定\n起始：橘猫回头看向镜头\n递进：橘猫跃起\n"
                 "收束：橘猫落在桌面上\n约束：无")
        result, _ = H3BaseLocalTest.run_local(self, [late, early], {"h3Mode": "image_video", "currentPrompt": "猫咪跳上桌子后回头看镜头"})
        self.assertIn("画面前方放着一张木桌", result["positivePrompt"])
        # An answer with the table set up and a missing word costs no retry.
        result, calls = H3BaseLocalTest.run_local(self, [fixed.replace("橘猫后腿发力", "橘猫蹲低身体")], {"h3Mode": "image_video", "currentPrompt": "橘猫直接跳上桌子，然后回头"})
        self.assertEqual(len(calls), 1)
        self.assertIn("回头", result["positivePrompt"])


if __name__ == "__main__":
    unittest.main()
