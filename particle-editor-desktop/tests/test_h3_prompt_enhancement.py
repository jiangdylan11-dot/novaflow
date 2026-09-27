import importlib.util
import json
from pathlib import Path
import re
import sys
import unittest
from unittest import mock

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
            self.assertRegex(prompt, r'补充要求[^\n]*\n' + re.escape(requirement))
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
        for _, kwargs in calls:
            # The local model gets its own short Chinese instruction, not the shared policy block.
            self.assertIn(service.MINIMAX_H3_FIVE_SECTION_RULES, kwargs["llama_template"])
            self.assertNotIn(INSTRUCTION, kwargs["llama_template"])
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


PHASES = ["橘猫趴在洒满阳光的窗台上，镜头从侧面跟随。", "橘猫前爪向前伸直，背部下压，缓慢伸懒腰。",
          "后腿蹬起，身体前倾，从窗台一跃而下。", "四爪落地，尾巴轻摆，站稳后抬头。", "1. 保持橘猫外观一致\n2. 动作连贯"]
CAT = "一只橘猫在窗台上伸懒腰，然后跳下窗台"


def phases(labels=("概述", "起始", "递进", "收束", "约束"), form="{label}：{text}", joiner="\n"):
    return joiner.join(form.format(label=label, text=text) for label, text in zip(labels, PHASES))


class H3FiveSectionLocalTest(unittest.TestCase):
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
        self.assertTrue(expected.startswith("【任务定位】\n文生视频，时长5秒。无参考媒体。"))
        self.assertIn("0-1.7s：橘猫前爪向前伸直", expected)
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
        # The pose leaves "姿态和背景保持不变"; the background item stays.
        self.assertIn("【连续性与约束】\n1. 动作从图中姿态自然开始。\n2. 背景保持不变。\n3. 动作连贯。", text)
        self.assertNotIn("不改变初始姿态", text)
        self.assertIn("不改变初始姿态", compile_action_phases(answer, "T2VA", 5, "橘猫蹲坐在窗台上，保持静止"))

    def test_first_last_frame_video_ends_on_its_last_frame_not_a_loop(self):
        answer = ("概述：女神在台阶上静坐，镜头固定。\n起始：权杖上的光点缓缓飘起。\n递进：光点绕着权杖慢慢旋转。\n"
                  "收束：光点落定，画面与 < Picture 2 > 一致。\n约束：1. 外观与背景和两张图一致")
        result, _ = self.run_local([answer], {"h3Mode": "first_last", "currentPrompt": "从首帧无缝过渡到尾帧"})
        self.assertIn("画面与 <Picture 2> 一致。", result["positivePrompt"])
        # A requested loop in text-to-video still has to close.
        with self.assertRaisesRegex(ValueError, "循环"):
            self.run_local([phases(), phases()], {"currentPrompt": CAT + "，无缝循环"})

    def test_rules_are_sent_only_when_the_user_asks(self):
        _, calls = self.run_local([phases()], {})
        prompt, kwargs = calls[0]
        for leaked in ["胸肩", "呼吸", "绿", "循环", "无缝", "下一轮", "User requirement", "补充要求", "I2VA", "T2VA"]:
            self.assertNotIn(leaked, prompt + kwargs["llama_template"])
        self.assertIn("任务：文生视频，时长5秒。", prompt)
        self.assertIn("起始（0-1.7秒）", prompt)
        idle = "一位女战士站立，角色仅呼吸待机，绿幕背景，无缝循环，镜头固定"
        prompt = service.build_minimax_h3_five_section_request(idle, "", "T2VA", 3)
        for asked in ["仅呼吸待机：", "纯色背景：", "循环：", "镜头固定："]:
            self.assertIn(asked, prompt)
        self.assertNotIn("保持静止：", prompt)
        self.assertIn("收束（2-3秒）：动作怎样平滑回到起始姿态", prompt)

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
        self.assertIn("5.3-8s：信子收回，镜头停在巨蛇头部。", text)
        self.assertIn("【连续性与约束】\n1. 主体外观和背景须与图一致。\n2. 镜头全程固定。", text)
        self.assertIn("2.7-5.3s：头部继续抬升，信子从口中探出。", text)
        for gone in ["初始姿态", "定格", "三阶段", "原提示词", "音乐", "嘶嘶声"]:
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
        self.assertIn("厨师在厨房颠锅炒菜，镜头跟随锅身。", text)
        self.assertIn("1.7-3.3s：厨师手腕上抖，食材翻起。", text)
        self.assertIn("3.3-5s：锅落回灶台。", text)
        self.assertIn("【连续性与约束】\n1. 场景始终为厨房。\n2. 镜头全程跟随。", text)
        asked = compile_action_phases(answer, "T2VA", 5, "厨师在厨房里颠锅炒菜，暖色调灯光，镜头先跟随再拉远，不得添加其他人物")
        for kept in ["暖色调灯光", "镜头拉远展现厨房", "不得添加其他人物或道具"]:
            self.assertIn(kept, asked)
        self.assertNotIn("镜头推近", asked)

    def test_breathing_idle_keeps_breathing_to_the_end(self):
        answer = ("概述：女战士站在绿幕前呼吸待机，镜头固定。\n起始：胸肩随吸气微微抬起。\n递进：胸肩随呼气缓缓回落。\n"
                  "收束：胸肩再次微微抬起，呼吸节奏归于静止。\n约束：1. 头部和手臂不动")
        text = compile_action_phases(answer, "T2VA", 3, "女战士站立，仅呼吸待机，绿幕背景")
        self.assertIn("2-3s：胸肩再次微微抬起。", text)
        self.assertNotIn("归于静止", text)
        self.assertIn("收束（2-3秒）：呼吸继续平稳起伏", service.build_minimax_h3_five_section_request("女战士站立，仅呼吸待机", "", "T2VA", 3))

    def test_speaker_and_request_describe_the_user_actions(self):
        source = '小机器人给花浇水，抬头对镜头说话\n(S1)："今天的花开得真好。"'
        text = compile_action_phases(phases(), "I2VA", 5, source)
        self.assertIn("<Subject 1> = (S1)，<Picture 1> 中说这句台词的角色。", text)
        prompt = service.build_minimax_h3_five_section_request(source, "", "I2VA", 5, sees_frames=True, dialogue_lines=['(S1)："今天的花开得真好。"'])
        self.assertIn("- 小机器人给花浇水\n- 抬头对镜头说话\n", prompt)
        self.assertIn("没有嘴就只写点头或图中已有的灯光闪动", prompt)
        self.assertIn("写清它从画面哪里出现", prompt)
        self.assertNotIn("三阶段", prompt)
        kite = service.build_minimax_h3_five_section_request("一个小男孩在草地上放风筝", "镜头缓慢推近，加上风声", "T2VA", 5)
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
        same = service.build_minimax_h3_five_section_request("从首帧自然过渡到尾帧", "", "FL2VA", 5, sees_frames=True, same_frames=True)
        self.assertIn("这两张图几乎相同：主体全程保持图中的姿态和位置", same)
        self.assertNotRegex(same, "胸肩|呼吸待机|- 从首帧")
        self.assertNotIn("几乎相同", service.build_minimax_h3_five_section_request("从首帧自然过渡到尾帧", "", "FL2VA", 5, sees_frames=True))
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
            self.assertTrue(result["positivePrompt"].startswith("【任务定位】\n图生视频，时长5秒。<Picture 1> 为起始首帧。"))
            frames = [{"label": "<Picture 1>", "dataUrl": frame}, {"label": "<Picture 2>", "dataUrl": frame + "B"}]
            result, calls = self.run_local([phases()], {"h3Mode": "first_last", "currentPrompt": "从首帧自然过渡到尾帧", "h3ReferenceFrames": frames})
            prompt, kwargs = calls[0]
            self.assertEqual(len(kwargs["images"]), 2)
            self.assertEqual(prompt.count(service.QWEN3_CHAT_VISION_TOKEN), 2)
            self.assertIn("收束（3.3-5秒）：动作怎样平稳完成，姿态、位置和光效变成 <Picture 2> 的样子，最后的画面与 <Picture 2> 一致", prompt)
            self.assertIn("首尾帧视频，时长5秒。<Picture 1> 为起始首帧，<Picture 2> 为结束尾帧。", result["positivePrompt"])
            self.assertIn("3.3-5s：四爪落地，尾巴轻摆，站稳后抬头。结束时画面与 <Picture 2> 一致。", result["positivePrompt"])
        # An unreadable picture never fails the request; the model is told it cannot see it.
        with mock.patch.object(service, "data_url_to_tensor", side_effect=OSError("broken")):
            result, calls = self.run_local([phases()], {"h3Mode": "image_video", "currentPrompt": "她转身向镜头挥手",
                                                        "h3ReferenceFrames": [{"label": "<Picture 1>", "dataUrl": frame}]})
        prompt, kwargs = calls[0]
        self.assertIsNone(kwargs["images"])
        self.assertNotIn(service.QWEN3_CHAT_VISION_TOKEN, prompt)
        self.assertIn("你看不到这张图", prompt)
        self.assertIn("【任务定位】\n图生视频", result["positivePrompt"])


if __name__ == "__main__":
    unittest.main()
