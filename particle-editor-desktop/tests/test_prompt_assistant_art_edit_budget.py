from __future__ import annotations

import importlib.util
import json
import socket
import sys
import unittest
from pathlib import Path
from unittest import mock


SERVICE_PATH = Path(__file__).resolve().parents[1] / "prompt-assistant-service.py"
sys.path.insert(0, str(SERVICE_PATH.parent))
SPEC = importlib.util.spec_from_file_location("novaflow_prompt_assistant_service", SERVICE_PATH)
SERVICE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(SERVICE)


class GenerationCaptured(RuntimeError):
    pass


class PromptAssistantArtEditBudgetTests(unittest.TestCase):
    @staticmethod
    def patch(
        segment_id: str,
        target_quote: str,
        replacement: str,
    ) -> dict:
        return {
            "segment_id": segment_id,
            "target_quote": target_quote,
            "replacement": replacement,
        }

    @staticmethod
    def patch_output(*patches: dict, **extra: object) -> str:
        payload = {"patches": list(patches), **extra}
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    @staticmethod
    def long_art_base() -> str:
        return (
            "两位25岁以上的成年东方女性角色亲密依偎，身份和数量必须保持。"
            "左侧女性身穿青绿色汉服与半透明披帛，佩戴翡翠首饰。"
            "右侧女性身穿象牙白与淡金色华服，佩戴金色发冠。"
            "两人坐在丝绸床榻上温柔亲吻，四只手和双腿归属明确。"
            "背景采用明亮象牙白宫廷空间，保留丝绸帷幔和雕花屏风。"
            "近距离双人全身构图，略微俯视，形成三角结构和S形视觉动线。"
            "画面为顶级中国幻想RPG游戏CG，精致东方二次元厚涂。"
            "肌肤保持手绘质感，服装具有丝绸薄纱和精细刺绣材质。"
            "两人的乌黑长发具有清晰发束、高光和细腻手绘层次，不能互相融合。"
            "肩膀、锁骨、手臂和双腿接受柔和暖光，保留自然高光与轻微红润感。"
            "整体以青绿色、象牙白和淡金色为主色，维持清透柔和的东方幻想氛围。"
            "要求两张脸五官不同，身体交叠合理，服装头发首饰不能错误融合。"
            "避免真人摄影、3D渲染、塑料皮肤、错误手指、多余肢体和复制脸。"
        )

    @staticmethod
    def mixed_pair_long_base() -> str:
        return (
            "两位25岁以上的成年东方女性，中国幻想游戏中的绝美女性角色。\n\n"
            "两人都拥有精致柔美的东方五官、白皙细腻的肌肤、丰满而匀称的成年女性身材以及乌黑浓密的长发。\n\n"
            "左侧女性身穿青绿色中国幻想华服，服装融合古典汉服与轻薄丝纱，佩戴翡翠首饰。\n\n"
            "右侧女性身穿象牙白与淡金色中国幻想华服，带有金色刺绣，佩戴金色发冠。\n\n"
            "两位女性坐在柔软的丝绸床榻上，身体紧密依偎，双腿自然交叠。"
            "左侧女性一只手扶住另一人的长发；右侧女性轻轻靠向她。\n\n"
            "两人的脸非常接近，正在温柔亲吻，双眼半闭，表情亲密柔和。\n\n"
            "长发、薄纱、披帛与裙摆自然交叠，形成丰富流畅的曲线构图。\n\n"
            "肌肤具有细腻柔润的绘画质感，保持高级游戏插画的手绘质感。\n\n"
            "背景采用极简明亮的象牙白与淡金色中国宫廷空间，保留丝绸帷幔与雕花屏风。\n\n"
            "近距离双人全身构图，略微俯视视角，形成稳定三角结构与S形视觉动线。\n\n"
            "顶级中国幻想RPG游戏CG，精致东方二次元厚涂，高完成度商业游戏美宣插画。\n\n"
            "人物面部采用精细二次元与半写实融合表现，头发具有清晰发束与手绘层次。\n\n"
            "柔和高调光线，以青绿色、象牙白和淡金色为主色，保持清透柔和氛围。\n\n"
            "要求：两位角色必须明确为成年女性；两张脸五官不同；四只手结构正确且归属明确。\n\n"
            "避免：真人摄影、3D渲染、塑料皮肤、幼态儿童比例、错误手指和融合肢体。\n\n"
            "画面目标：一张高完成度、性感柔美的中国幻想双女性角色游戏CG厚涂插画。"
        )

    def capture_budget(self, payload: dict) -> dict:
        assistant = SERVICE.PromptAssistant()
        captured: dict = {}

        def capture(prompt: str, **kwargs):
            captured["prompt"] = prompt
            captured.update(kwargs)
            raise GenerationCaptured()

        assistant.generate = capture
        with self.assertRaises(GenerationCaptured):
            assistant.optimize_prompt(payload)
        return captured

    def test_art_budget_scales_after_short_prompt_threshold_and_is_capped(self):
        threshold = SERVICE.ORDINARY_ART_PROMPT_BASE_CHAR_THRESHOLD
        self.assertEqual(
            SERVICE.ordinary_art_prompt_output_max_length("短" * 100),
            SERVICE.ORDINARY_ART_PROMPT_BASE_MAX_LENGTH,
        )
        self.assertEqual(
            SERVICE.ordinary_art_prompt_output_max_length("短" * threshold),
            SERVICE.ORDINARY_ART_PROMPT_BASE_MAX_LENGTH,
        )
        self.assertGreater(
            SERVICE.ordinary_art_prompt_output_max_length("长" * 1000),
            SERVICE.ORDINARY_ART_PROMPT_BASE_MAX_LENGTH,
        )
        self.assertEqual(
            SERVICE.ordinary_art_prompt_output_max_length("长" * 1232),
            773,
        )
        self.assertEqual(
            SERVICE.ordinary_art_prompt_output_max_length("长" * 20000),
            SERVICE.ORDINARY_ART_PROMPT_MAX_LENGTH,
        )

    def test_long_art_edit_uses_complete_base_and_local_edit_contract(self):
        raw_prompt = (
            "两位明确成年的东方女性角色亲密依偎，服装、动作、手脚归属、构图、"
            "中国幻想RPG厚涂风格、丝绸材质与避免项均需保持。"
        ) * 30 + "唯一背景描述：象牙白宫廷高光明亮，丝绸帷幔和雕花屏风清晰可见。"
        requirements = "背景过于曝光，降低背景高光，但保留人物和其余全部设定。"
        assistant = SERVICE.PromptAssistant()
        captured: dict = {}
        target_quote = "唯一背景描述：象牙白宫廷高光明亮"
        replacement = "唯一背景描述：象牙白宫廷明亮但曝光受控，高光不过曝"

        def generate(prompt: str, **kwargs):
            captured["prompt"] = prompt
            captured.update(kwargs)
            return self.patch_output(self.patch("P01", target_quote, replacement))

        assistant.generate = generate
        result = assistant.optimize_prompt({
            "surface": "art",
            "purpose": "optimize",
            "prompt": raw_prompt,
            "requirements": requirements,
        })

        self.assertEqual(captured["max_length"], SERVICE.ORDINARY_ART_PROMPT_PATCH_MAX_LENGTH)
        self.assertIn(raw_prompt, captured["prompt"])
        self.assertIn(requirements, captured["prompt"])
        self.assertIn("局部编辑器", captured["prompt"])
        self.assertIn("target_quote", captured["prompt"])
        self.assertIn("不能把画面翻到相反极端", captured["prompt"])
        self.assertIn("不能改成暗淡", captured["prompt"])
        self.assertIn("不能完整照抄原句后追加一句修改意见", captured["prompt"])
        self.assertIn("泛化形容词通常不足以表达修改目标", captured["prompt"])
        self.assertIn(replacement, result["positivePrompt"])
        self.assertEqual(result["editContract"], "deterministic-merge-v1")

    def test_unified_merge_replaces_conflicting_core_people_and_action(self):
        base = (
            "主体：两位成年东方女性身穿华服，坐在丝绸床榻上温柔亲吻。\n\n"
            "风格：高完成度东方幻想游戏CG厚涂，细腻手绘材质。\n\n"
            "要求：人物结构自然，肢体归属明确。"
        )
        replacement = "主体：成年男人裸体躺在床上，仅呈现下半身，成年女人坐在男人身上。"
        assistant = SERVICE.PromptAssistant()
        captured = {}

        def generate(prompt: str, **kwargs):
            captured["prompt"] = prompt
            captured.update(kwargs)
            return self.patch_output(self.patch(
                "P01",
                "两位成年东方女性身穿华服，坐在丝绸床榻上温柔亲吻",
                "成年男人裸体躺在床上，仅呈现下半身，成年女人坐在男人身上",
            ))

        assistant.generate = generate
        result = assistant.optimize_prompt({
            "surface": "art",
            "purpose": "optimize",
            "prompt": base,
            "requirements": "男人躺在床上，裸体，只看得到下半身，女人坐在男人身上",
            "supportsNegativePrompt": False,
            "nsfw": True,
        })

        self.assertEqual(result["positivePrompt"], (
            f"{replacement}\n\n"
            "风格：高完成度东方幻想游戏CG厚涂，细腻手绘材质。\n\n"
            "要求：人物结构自然，肢体归属明确。"
        ))
        self.assertEqual(result["editContract"], "deterministic-merge-v1")
        self.assertIn("target_quote 不需要与用户要求共享字词", captured["prompt"])
        self.assertIn("用户已开启 NSFW", captured["prompt"])
        self.assertIn("性别、成年身份、裸体状态、身体姿势与人物关系", captured["prompt"])
        self.assertIn("任何未成年人相关内容仍然禁止", captured["prompt"])

    def test_core_redefinition_closes_stale_subjects_after_primary_patch(self):
        base = (
            "主体人数：两位明确成年的东方女性。\n\n"
            "外观：两人都拥有丰满匀称的成年女性身材与乌黑长发。\n\n"
            "动作：两人坐在床上温柔亲吻。\n\n"
            "风格：高完成度东方幻想游戏CG厚涂。"
        )
        requirements = "男人躺在床上，裸体，只看得到下半身，女人坐在男人身上"
        stale_action_only = self.patch_output(self.patch(
            "P03",
            "动作：两人坐在床上温柔亲吻。",
            "动作：成年男人裸体躺在床上，只看得到下半身，成年女人坐在男人身上。",
        ))
        assistant = SERVICE.PromptAssistant()
        calls = []

        def generate(prompt: str, **_kwargs):
            calls.append(prompt)
            return stale_action_only

        assistant.generate = generate
        result = assistant.optimize_prompt({
            "surface": "art",
            "purpose": "optimize",
            "prompt": base,
            "requirements": requirements,
            "supportsNegativePrompt": False,
            "nsfw": True,
        })

        self.assertEqual(len(calls), 1)
        self.assertIn("必须扫描全部单元", calls[0])
        self.assertNotIn("两位明确成年的东方女性", result["positivePrompt"])
        self.assertNotIn("两人都拥有丰满匀称的成年女性身材", result["positivePrompt"])
        self.assertIn("成年男人裸体躺在床上", result["positivePrompt"])
        self.assertEqual(result["editContract"], "deterministic-merge-v1")

    def test_core_primary_patch_uses_bounded_deterministic_closure(self):
        base = self.mixed_pair_long_base()
        requirements = "男人裸体躺在床上，只看得到下半身，女人坐在男人身上"
        original_left_clothing = (
            "身穿青绿色中国幻想华服，服装融合古典汉服与轻薄丝纱，佩戴翡翠首饰。"
        )
        original_right_clothing = (
            "身穿象牙白与淡金色中国幻想华服，带有金色刺绣，佩戴金色发冠。"
        )
        original_background = (
            "背景采用极简明亮的象牙白与淡金色中国宫廷空间，保留丝绸帷幔与雕花屏风。"
        )
        original_style = (
            "顶级中国幻想RPG游戏CG，精致东方二次元厚涂，高完成度商业游戏美宣插画。"
        )
        original_avoid = (
            "避免：真人摄影、3D渲染、塑料皮肤、幼态儿童比例、错误手指和融合肢体。"
        )
        creative_action = (
            "一位成年男人裸体躺在柔软的丝绸床榻上，只看得到下半身；"
            "一位成年女人坐在男人身上，两人姿态关系明确。"
        )
        primary_output = self.patch_output(self.patch(
            "P05",
            "两位女性坐在柔软的丝绸床榻上，身体紧密依偎，双腿自然交叠。",
            creative_action,
        ))
        calls = []
        assistant = SERVICE.PromptAssistant()

        def generate(prompt: str, **_kwargs):
            calls.append(prompt)
            return primary_output

        assistant.generate = generate
        with mock.patch.object(
            SERVICE,
            "apply_ordinary_art_deterministic_mixed_pair_closure",
            wraps=SERVICE.apply_ordinary_art_deterministic_mixed_pair_closure,
        ) as closure_mock:
            result = assistant.optimize_prompt({
                "surface": "art",
                "purpose": "optimize",
                "prompt": base,
                "requirements": requirements,
                "supportsNegativePrompt": False,
                "nsfw": True,
            })

        positive = result["positivePrompt"]
        self.assertEqual(len(calls), 1)
        self.assertEqual(closure_mock.call_count, 1)
        self.assertEqual(
            closure_mock.call_args.kwargs["max_target_chars"],
            320
            - len("两位女性坐在柔软的丝绸床榻上，身体紧密依偎，双腿自然交叠。"),
        )
        self.assertEqual(closure_mock.call_args.kwargs["max_unit_count"], 8)
        self.assertIn(creative_action, positive)
        self.assertIn("成年男性与成年女性各自明确的体态", positive)
        self.assertIn(f"左侧角色{original_left_clothing}", positive)
        self.assertIn(f"右侧角色{original_right_clothing}", positive)
        self.assertIn("两位角色必须明确为成年男性与成年女性", positive)
        self.assertIn("中国幻想成年男女双角色游戏CG厚涂插画", positive)
        self.assertNotIn("成年女性身材", positive)
        self.assertNotIn("左侧女性", positive)
        self.assertNotIn("右侧女性", positive)
        self.assertIn("左侧角色一只手扶住另一人的长发", positive)
        self.assertIn("右侧角色轻轻靠向她", positive)
        self.assertNotIn("必须明确为成年女性", positive)
        self.assertNotIn("双女性角色", positive)
        self.assertIn(original_background, positive)
        self.assertIn(original_style, positive)
        self.assertIn(original_avoid, positive)
        self.assertIn("正在温柔亲吻", positive)
        self.assertEqual(result["editContract"], "deterministic-merge-v1")

    def test_deterministic_closure_rejects_unsupported_or_over_budget_units(self):
        requirements = "男人裸体躺在床上，只看得到下半身，女人坐在男人身上"
        target_budget_base = (
            "主体：两位成年女性。\n\n"
            "动作：两位成年女性坐在床上。"
        )
        target_budget_candidate = target_budget_base.replace(
            "动作：两位成年女性坐在床上。",
            "动作：成年男人裸体躺在床上，只看得到下半身，成年女人坐在男人身上。",
        )
        failure = SERVICE.ordinary_art_change_application_failure(
            target_budget_base,
            requirements,
            target_budget_candidate,
        )
        diagnostics = {}
        self.assertEqual(
            SERVICE.apply_ordinary_art_deterministic_mixed_pair_closure(
                target_budget_base,
                requirements,
                target_budget_candidate,
                failure,
                diagnostics,
                max_target_chars=len("两位成年女性") - 1,
            ),
            "",
        )
        self.assertEqual(
            diagnostics["failureReason"],
            "deterministic-closure-target-budget-exceeded",
        )

        unsupported_base = (
            "主体：两人都是女性，且两位都是成年人。\n\n"
            "动作：两人坐在床上。"
        )
        unsupported_candidate = unsupported_base.replace(
            "动作：两人坐在床上。",
            "动作：成年男人裸体躺在床上，只看得到下半身，成年女人坐在男人身上。",
        )
        failure = SERVICE.ordinary_art_change_application_failure(
            unsupported_base,
            requirements,
            unsupported_candidate,
        )
        diagnostics = {}
        self.assertEqual(
            SERVICE.apply_ordinary_art_deterministic_mixed_pair_closure(
                unsupported_base,
                requirements,
                unsupported_candidate,
                failure,
                diagnostics,
            ),
            "",
        )
        self.assertEqual(
            diagnostics["failureReason"],
            "deterministic-closure-unit-unsupported:P01",
        )

        nine_stale_units = "\n\n".join(
            f"画面目标{index}：成年人物构图，双女性角色。"
            for index in range(1, 10)
        )
        over_budget_base = (
            f"{nine_stale_units}\n\n"
            "动作：两位成年女性坐在床上。"
        )
        over_budget_candidate = over_budget_base.replace(
            "动作：两位成年女性坐在床上。",
            "动作：成年男人裸体躺在床上，只看得到下半身，成年女人坐在男人身上。",
        )
        failure = SERVICE.ordinary_art_change_application_failure(
            over_budget_base,
            requirements,
            over_budget_candidate,
        )
        diagnostics = {}
        self.assertEqual(
            SERVICE.apply_ordinary_art_deterministic_mixed_pair_closure(
                over_budget_base,
                requirements,
                over_budget_candidate,
                failure,
                diagnostics,
            ),
            "",
        )
        self.assertEqual(
            diagnostics["failureReason"],
            "deterministic-closure-unit-budget-exceeded",
        )

    def test_core_scoped_repair_rejects_out_of_scope_or_incomplete_units(self):
        base = (
            "主体人数：两位明确成年的东方女性。\n\n"
            "外观：两人都拥有丰满匀称的成年女性身材与乌黑长发。\n\n"
            "动作：两人坐在床上温柔亲吻。\n\n"
            "风格：高完成度东方幻想游戏CG厚涂。"
        )
        requirements = "男人躺在床上，裸体，只看得到下半身，女人坐在男人身上"
        action_only = self.patch_output(self.patch(
            "P03",
            "动作：两人坐在床上温柔亲吻。",
            "动作：成年男人裸体躺在床上，只看得到下半身，成年女人坐在男人身上。",
        ))
        incremental_base = SERVICE.apply_ordinary_art_patch_output(
            base,
            requirements,
            action_only,
        )
        out_of_scope_diagnostics = {}
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                incremental_base,
                requirements,
                action_only,
                out_of_scope_diagnostics,
                allowed_unit_ids=["P01", "P02"],
                max_patch_count=3,
                max_target_chars=306,
            ),
            "",
        )
        self.assertEqual(
            out_of_scope_diagnostics["failureReason"],
            "patch-repair-unit-out-of-scope:P03",
        )
        missing_diagnostics = {}
        p01_only = self.patch_output(self.patch(
            "P01",
            "主体人数：两位明确成年的东方女性。",
            "主体人数：一位明确成年的男性与一位明确成年的女性。",
        ))
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                incremental_base,
                requirements,
                p01_only,
                missing_diagnostics,
                allowed_unit_ids=["P01", "P02"],
                required_unit_ids=["P01", "P02"],
                max_patch_count=3,
                max_target_chars=306,
            ),
            "",
        )
        self.assertEqual(
            missing_diagnostics["failureReason"],
            "patch-required-units-missing:P02",
        )

    def test_primary_model_patch_limit_is_separate_from_deterministic_closure(self):
        base = (
            "主体人数：两位明确成年的东方女性。\n\n"
            "外观：两人都拥有丰满匀称的成年女性身材与乌黑长发。\n\n"
            "动作：两人坐在床上温柔亲吻。\n\n"
            "光线：柔和暖光。\n\n"
            "风格：东方幻想厚涂。"
        )
        requirements = "男人躺在床上，裸体，只看得到下半身，女人坐在男人身上"
        first_four_patches = self.patch_output(
            self.patch(
                "P03",
                "动作：两人坐在床上温柔亲吻。",
                "动作：成年男人裸体躺在床上，只看得到下半身，成年女人坐在男人身上。",
            ),
            self.patch("P04", "光线：柔和暖光。", "光线：柔和暖光与受控高光。"),
            self.patch("P05", "风格：东方幻想厚涂。", "风格：精细东方幻想厚涂。"),
            self.patch(
                "P01",
                "主体人数：两位明确成年的东方女性。",
                "主体人数：一位明确成年的男性与一位明确成年的女性。",
            ),
        )
        assistant = SERVICE.PromptAssistant()
        calls = []

        def generate(prompt: str, **_kwargs):
            calls.append(prompt)
            return first_four_patches

        assistant.generate = generate
        result = assistant.optimize_prompt({
            "surface": "art",
            "purpose": "optimize",
            "prompt": base,
            "requirements": requirements,
            "supportsNegativePrompt": False,
            "nsfw": True,
        })

        self.assertEqual(len(calls), 1)
        self.assertIn("一位明确成年的男性与一位明确成年的女性", result["positivePrompt"])
        self.assertNotIn("两人都拥有丰满匀称的成年女性身材", result["positivePrompt"])
        self.assertEqual(result["editContract"], "deterministic-merge-v1")

    def test_primary_model_and_deterministic_target_budget_stays_bounded(self):
        long_action = "动作：两人坐在床上温柔亲吻，" + ("A" * 130)
        long_material = "材质：" + ("B" * 145)
        base = (
            "主体人数：两位明确成年的东方女性。\n\n"
            "外观：两人都拥有丰满匀称的成年女性身材与乌黑长发。\n\n"
            f"{long_action}\n\n"
            f"{long_material}"
        )
        requirements = "男人躺在床上，裸体，只看得到下半身，女人坐在男人身上"
        first_two_patches = self.patch_output(
            self.patch(
                "P03",
                long_action,
                "动作：成年男人裸体躺在床上，只看得到下半身，成年女人坐在男人身上，"
                + ("A" * 100),
            ),
            self.patch("P04", long_material, "材质：" + ("C" * 145)),
        )
        first_target_chars = len(long_action) + len(long_material)
        self.assertLessEqual(first_target_chars, 320)
        self.assertLess(320 - first_target_chars, 42)
        assistant = SERVICE.PromptAssistant()
        calls = []

        def generate(prompt: str, **_kwargs):
            calls.append(prompt)
            return first_two_patches

        assistant.generate = generate
        with mock.patch.object(
            SERVICE,
            "apply_ordinary_art_deterministic_mixed_pair_closure",
            wraps=SERVICE.apply_ordinary_art_deterministic_mixed_pair_closure,
        ) as closure_mock:
            result = assistant.optimize_prompt({
                "surface": "art",
                "purpose": "optimize",
                "prompt": base,
                "requirements": requirements,
                "supportsNegativePrompt": False,
                "nsfw": True,
            })

        self.assertEqual(len(calls), 1)
        self.assertEqual(closure_mock.call_count, 1)
        self.assertEqual(
            closure_mock.call_args.kwargs["max_target_chars"],
            320 - first_target_chars,
        )
        self.assertEqual(result["editContract"], "deterministic-merge-v1")

    def test_core_gender_only_preserves_unmentioned_action(self):
        raw_prompt = (
            "主体：两位成年女性。\n\n"
            "动作：两人坐在床上温柔亲吻。"
        )
        candidate = (
            "主体：一位成年男性与一位成年女性。\n\n"
            "动作：两人坐在床上温柔亲吻。"
        )
        self.assertEqual(
            SERVICE.ordinary_art_core_redefinition_failure(
                raw_prompt,
                "把主体性别改为一位成年男性与一位成年女性",
                candidate,
            ),
            "",
        )

    def test_core_actor_context_polarity_and_addition_do_not_override_composition(self):
        raw_prompt = "主体：两位成年女性坐在床上。"
        candidate = "主体：两位成年女性坐在床上，画面采用男性向审美。"
        for requirements in (
            "男性向审美，女人坐在床上",
            "男性视角，女人坐在床上",
            "男性的视角，女人坐在床上",
            "不要男人，女人坐在床上",
            "女性向构图，男人坐在床上",
            "去掉裸体，女人坐在床上",
            "把人物年龄改为25岁，保持女性向审美",
        ):
            with self.subTest(requirements=requirements):
                self.assertEqual(
                    SERVICE.ordinary_art_core_redefinition_failure(
                        raw_prompt,
                        requirements,
                        candidate,
                    ),
                    "",
                )

        added_candidate = "主体：两位成年女性坐在床上，旁边新增一位成年男人。"
        self.assertEqual(
            SERVICE.ordinary_art_core_redefinition_failure(
                raw_prompt,
                "新增一个成年男人，不删除原有两位成年女性",
                added_candidate,
            ),
            "",
        )
        self.assertFalse(SERVICE.ordinary_art_core_one_of_two_replacement(
            "把人物年龄改为25岁以上",
        ))

        unclothed_man_requirement = "没有穿衣服的男人躺在床上，女人坐在他身上"
        self.assertTrue(SERVICE.ordinary_art_core_positive_mention_present(
            unclothed_man_requirement,
            SERVICE.ORDINARY_ART_CORE_MALE_PATTERN,
            actor_context=True,
        ))
        self.assertTrue(SERVICE.ordinary_art_core_redefinition_failure(
            raw_prompt,
            unclothed_man_requirement,
            raw_prompt,
        ))

    def test_core_gate_rejects_duo_and_unmapped_side_female_residue(self):
        raw_prompt = (
            "主体：两位成年女性。\n\n"
            "左侧女性身穿青绿色华服。\n\n"
            "右侧女性身穿象牙白华服。\n\n"
            "画面目标：高完成度双女性角色游戏CG。"
        )
        requirements = "男人裸体躺在床上，只看得到下半身，女人坐在男人身上"
        candidate = raw_prompt.replace(
            "主体：两位成年女性。",
            "主体：成年男人裸体躺在床上，只看得到下半身，成年女人坐在男人身上。",
        )
        self.assertEqual(
            SERVICE.ordinary_art_core_redefinition_failure(
                raw_prompt,
                requirements,
                candidate,
            ),
            "core-redefinition-incomplete:stale-female-group",
        )
        self.assertEqual(
            SERVICE.ordinary_art_core_conflicting_unit_ids(
                candidate,
                "core-redefinition-incomplete:stale-female-group",
            ),
            ["P02", "P03", "P04"],
        )

        duo_resolved = candidate.replace("双女性角色", "成年男女双角色")
        self.assertEqual(
            SERVICE.ordinary_art_core_redefinition_failure(
                raw_prompt,
                requirements,
                duo_resolved,
            ),
            "core-redefinition-incomplete:stale-side-female-identities",
        )
        fully_resolved = duo_resolved.replace("左侧女性", "左侧角色").replace(
            "右侧女性",
            "右侧角色",
        )
        self.assertEqual(
            SERVICE.ordinary_art_core_redefinition_failure(
                raw_prompt,
                requirements,
                fully_resolved,
            ),
            "",
        )

    def test_core_one_of_two_replacement_enforces_mixed_pair_composition(self):
        raw_prompt = (
            "主体人数：两位明确成年的东方女性。\n\n"
            "动作：两人坐在床上温柔亲吻。"
        )
        requirements = "把两位女性中的一位替换为成年男人"
        three_person_candidate = (
            "主体人数：两位明确成年的东方女性与一位成年男人。\n\n"
            "动作：三人坐在床上温柔亲吻。"
        )
        self.assertEqual(
            SERVICE.ordinary_art_core_redefinition_failure(
                raw_prompt,
                requirements,
                three_person_candidate,
            ),
            "core-redefinition-incomplete:one-of-two-composition",
        )

        enumerated_three_person_candidate = (
            "主体：三人，一位成年男人、一位成年女人、另一位成年女人。\n\n"
            "动作：三人站立。"
        )
        self.assertEqual(
            SERVICE.ordinary_art_core_redefinition_failure(
                raw_prompt,
                requirements,
                enumerated_three_person_candidate,
            ),
            "core-redefinition-incomplete:one-of-two-composition",
        )

        mixed_pair_candidate = (
            "主体人数：一位明确成年的东方女性与一位成年男人。\n\n"
            "动作：两人坐在床上温柔亲吻。"
        )
        self.assertEqual(
            SERVICE.ordinary_art_core_redefinition_failure(
                raw_prompt,
                requirements,
                mixed_pair_candidate,
            ),
            "",
        )

        natural_pair_candidate = (
            "主体：一位成年男人躺着，另一位成年女人坐在他身上。\n\n"
            "构图：第三人称视角。"
        )
        self.assertEqual(
            SERVICE.ordinary_art_core_redefinition_failure(
                raw_prompt,
                requirements,
                natural_pair_candidate,
            ),
            "",
        )

        self.assertEqual(
            SERVICE.ordinary_art_core_redefinition_failure(
                "SUBJECT: two adult women.",
                "replace one of the two women with an adult man",
                "SUBJECT: an adult man and an adult woman.",
            ),
            "",
        )

    def test_patch_prompt_omits_nsfw_context_when_false_or_omitted(self):
        base = "主体：两位明确成年的人物保持原有姿势。"
        requirements = "调整人物姿势"
        default_prompt = SERVICE.build_ordinary_art_patch_repair_prompt(
            base,
            requirements,
            "test-default",
        )
        false_prompt = SERVICE.build_ordinary_art_patch_repair_prompt(
            base,
            requirements,
            "test-false",
            False,
        )
        for prompt in (default_prompt, false_prompt):
            self.assertNotIn("成人内容上下文", prompt)
            self.assertNotIn("用户已开启 NSFW", prompt)

    def test_unified_merge_extends_existing_scene_with_white_cat(self):
        base = (
            "主体：一位成年女法师坐在窗边阅读古籍。\n\n"
            "场景：温暖木质书房，窗外细雨朦胧。\n\n"
            "画面目标：安静细腻的东方幻想游戏CG。"
        )
        assistant = SERVICE.PromptAssistant()
        assistant.generate = lambda _prompt, **_kwargs: self.patch_output(self.patch(
            "P02",
            "温暖木质书房，窗外细雨朦胧",
            "温暖木质书房，窗外细雨朦胧，脚边补充一只安静蜷卧的白猫",
        ))
        result = assistant.optimize_prompt({
            "surface": "art",
            "purpose": "optimize",
            "prompt": base,
            "requirements": "补充一只白猫",
            "supportsNegativePrompt": False,
        })

        self.assertIn("脚边补充一只安静蜷卧的白猫", result["positivePrompt"])
        self.assertIn("主体：一位成年女法师坐在窗边阅读古籍。", result["positivePrompt"])
        self.assertIn("画面目标：安静细腻的东方幻想游戏CG。", result["positivePrompt"])
        self.assertEqual(result["editContract"], "deterministic-merge-v1")

    def test_problem_feedback_compiles_to_generic_final_state_hints(self):
        cases = (
            (
                "背景过于曝光",
                "保留背景的原有内容与审美意图，只消除‘曝光’的过度状态，呈现自然、受控且细节清楚的最终效果",
            ),
            (
                "暗部太黑",
                "保留暗部的原有内容与审美意图，只消除‘黑’的过度状态，呈现自然、受控且细节清楚的最终效果",
            ),
            (
                "服装不够精细",
                "保留服装的原有内容与审美意图，补足‘精细’的不足，呈现充分、清晰且完整的最终效果",
            ),
            (
                "材质太塑料",
                "保留材质的原有内容与审美意图，只消除‘塑料’的过度状态，呈现自然、受控且细节清楚的最终效果",
            ),
            (
                "构图太挤，但保留人物和动作",
                "保留构图的原有内容与审美意图，只消除‘挤’的过度状态，呈现自然、受控且细节清楚的最终效果",
            ),
            (
                "背景过于曝光，降低背景高光，但保留人物和构图",
                "保留背景的原有内容与审美意图，只消除‘曝光’的过度状态，呈现自然、受控且细节清楚的最终效果",
            ),
            ("人物面部模糊", "人物面部清晰可见且细节完整"),
            ("手部结构错误", "手部结构准确、自然且合理"),
        )
        for instruction, expected in cases:
            with self.subTest(instruction=instruction):
                self.assertEqual(
                    SERVICE.ordinary_art_problem_resolution_hint(instruction),
                    expected,
                )

        prompt = SERVICE.build_ordinary_art_patch_repair_prompt(
            "背景采用极简明亮的象牙白宫廷空间。",
            "用户本次修改要求（最高优先级）：背景过于曝光",
            "primary-local-edit",
        )
        self.assertIn("replacement 必须实现", prompt)
        self.assertIn("只消除‘曝光’的过度状态", prompt)
        self.assertGreater(prompt.rfind("最终语义检查"), prompt.rfind("[P01]"))
        self.assertEqual(
            SERVICE.ordinary_art_problem_resolution_hint("增加过度曝光的梦境效果"),
            "",
        )

    def test_compound_feedback_is_one_unified_requirement_with_optional_clauses(self):
        requirements = "用户本次修改要求（最高优先级）：背景太曝光，人物太写实"
        self.assertEqual(
            SERVICE.ordinary_art_patch_intents(requirements),
            [{"id": "I01", "text": "背景太曝光，人物太写实"}],
        )
        for value in (
            "背景太曝光。人物太写实。",
            "背景太曝光但人物太写实",
            "背景太曝光并且人物太写实",
        ):
            with self.subTest(value=value):
                self.assertEqual(
                    SERVICE.ordinary_art_patch_intents(value),
                    [{"id": "I01", "text": value}],
                )
                self.assertEqual(
                    SERVICE.ordinary_art_patch_feedback_clauses(value),
                    ["背景太曝光", "人物太写实"],
                )
        self.assertEqual(
            SERVICE.ordinary_art_patch_feedback_clauses(
                "背景太曝光，降低高光，人物太写实"
            ),
            ["背景太曝光，降低高光", "人物太写实"],
        )
        self.assertTrue(SERVICE.ordinary_art_instruction_describes_problem("人物太写实"))
        self.assertEqual(SERVICE.ordinary_art_problem_resolution_hint("太阳照亮场景"), "")
        self.assertEqual(SERVICE.ordinary_art_problem_resolution_hint("太空环境补光"), "")

    def test_unified_multi_patch_applies_problem_fixes_without_cross_wiring(self):
        base = (
            "背景采用明亮象牙白宫廷空间，背景曝光和高光过强，帷幔与屏风仍须保留。\n\n"
            "人物面部采用接近真人摄影的写实塑造，原有东方五官和身份保持。"
        )
        requirements = "用户本次修改要求（最高优先级）：背景太曝光，人物太写实"
        background_patch = self.patch(
            "P01",
            "背景采用明亮象牙白宫廷空间，背景曝光和高光过强",
            "背景保持明亮象牙白宫廷空间，曝光与高光受控，细节清晰可见",
        )
        person_replacement = "人物面部采用精致东方二次元厚涂塑造，弱化写实感，保留东方五官与身份"
        output = self.patch_output(
            background_patch,
            self.patch(
                "P02",
                "人物面部采用接近真人摄影的写实塑造，原有东方五官和身份保持",
                person_replacement,
            ),
        )
        diagnostics = {}
        merged = SERVICE.apply_ordinary_art_patch_output(
            base,
            requirements,
            output,
            diagnostics,
        )
        self.assertTrue(merged)
        self.assertEqual(diagnostics.get("coveredIntents"), ["I01"])
        self.assertEqual(diagnostics.get("patchCount"), 2)
        self.assertIn(person_replacement, merged)
        background_paragraph, person_paragraph = merged.split("\n\n", 1)
        self.assertNotIn("二次元", background_paragraph)
        self.assertNotIn("写实", background_paragraph)
        person_paragraph = merged.split("\n\n", 1)[1]
        self.assertNotIn("曝光", person_paragraph)
        self.assertNotIn("背景", person_paragraph)

        person_target = "人物面部采用接近真人摄影的写实塑造，原有东方五官和身份保持"
        bad_person_replacement = (
            "人物面部采用东方二次元厚涂，弱化写实感，并消除背景曝光的过度状态"
        )
        output = self.patch_output(
            background_patch,
            self.patch(
                "P02",
                person_target,
                bad_person_replacement,
            ),
        )
        diagnostics = {}
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                base, requirements, output, diagnostics
            ),
            "",
        )
        self.assertEqual(
            diagnostics.get("failureReason"),
            "patch-cross-requirement-content:C01",
        )
        self.assertEqual(diagnostics.get("foreignClauseId"), "C01")

        echo_diagnostics = {}
        echo = self.patch_output(
            background_patch,
            self.patch("P02", person_target, "人物依然太写实"),
        )
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                base, requirements, echo, echo_diagnostics
            ),
            "",
        )
        self.assertEqual(
            echo_diagnostics.get("failureReason"),
            "patch-repeats-problem-state",
        )

    def test_one_unified_requirement_may_use_multiple_anchors_but_total_stays_bounded(self):
        base = "人物面部太写实。\n\n人物肌肤具有真人摄影质感。"
        requirements = "人物太写实"
        output = self.patch_output(
            self.patch("P01", "人物面部太写实", "人物面部弱化写实感，采用二次元厚涂"),
            self.patch("P02", "人物肌肤具有真人摄影质感", "人物肌肤保留手绘质感，避免真人摄影感"),
        )
        diagnostics = {}
        merged = SERVICE.apply_ordinary_art_patch_output(
            base, requirements, output, diagnostics
        )
        self.assertTrue(merged)
        self.assertEqual(diagnostics.get("patchCount"), 2)
        self.assertEqual(diagnostics.get("coveredIntents"), ["I01"])

    def test_many_comma_clauses_remain_one_unified_edit_request(self):
        assistant = SERVICE.PromptAssistant()
        calls = []
        requirements = "背景更柔和，人物更厚涂，服装更精细，构图更舒展，光线更自然"

        def generate(prompt, **_kwargs):
            calls.append(prompt)
            return self.patch_output(self.patch(
                "P01",
                "主体、背景、服装、构图和光线均已有完整描述",
                "主体厚涂自然，背景柔和，服装精细，构图舒展，光线自然",
            ))

        assistant.generate = generate
        result = assistant.optimize_prompt({
            "surface": "art",
            "purpose": "optimize",
            "prompt": "主体、背景、服装、构图和光线均已有完整描述。",
            "requirements": requirements,
            "supportsNegativePrompt": False,
        })
        self.assertEqual(len(calls), 1)
        self.assertEqual(
            SERVICE.ordinary_art_patch_intents(requirements),
            [{"id": "I01", "text": requirements}],
        )
        self.assertEqual(result["editContract"], "deterministic-merge-v1")

    def test_patch_retry_is_skipped_when_first_attempt_reaches_120_seconds(self):
        assistant = SERVICE.PromptAssistant()
        calls = []
        assistant.generate = lambda *_args, **_kwargs: calls.append(True) or "not-json"
        with mock.patch.object(SERVICE.time, "monotonic", side_effect=[0.0, 120.0, 120.0]):
            with self.assertRaises(SERVICE.OrdinaryArtPromptEditNotAppliedError):
                assistant.optimize_prompt({
                    "surface": "art",
                    "purpose": "optimize",
                    "prompt": "背景曝光过强。",
                    "requirements": "背景太曝光",
                    "supportsNegativePrompt": False,
                })
        self.assertEqual(len(calls), 1)

    def test_process_guard_is_explicit_nonblocking_and_import_safe(self):
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        probe.bind((SERVICE.PROMPT_ASSISTANT_GUARD_HOST, 0))
        port = probe.getsockname()[1]
        probe.close()
        first = SERVICE.acquire_prompt_assistant_guard_socket(port)
        try:
            with self.assertRaises(SERVICE.PromptAssistantAlreadyRunningError):
                SERVICE.acquire_prompt_assistant_guard_socket(port)
        finally:
            first.close()
        reopened = SERVICE.acquire_prompt_assistant_guard_socket(port)
        reopened.close()

    def test_short_art_edit_uses_patch_budget(self):
        captured = self.capture_budget({
            "surface": "art",
            "purpose": "optimize",
            "prompt": "成年女性角色站在宫殿中",
            "requirements": "背景更柔和",
        })
        self.assertEqual(captured["max_length"], SERVICE.ORDINARY_ART_PROMPT_PATCH_MAX_LENGTH)

    def test_non_art_and_create_budgets_are_unchanged(self):
        long_prompt = "长提示" * 1000
        cases = (
            ({"surface": "art", "prompt": "", "requirements": "从零创作一位成年角色"}, 180),
            ({"surface": "animation", "prompt": long_prompt, "requirements": "保持动作"}, 240),
            ({"surface": "ui-design", "prompt": long_prompt, "requirements": "保持结构"}, 260),
            ({
                "surface": "animation",
                "purpose": SERVICE.MINIMAX_H3_PROMPT_PURPOSE,
                "prompt": long_prompt,
                "requirements": "mode:T2VA duration:5秒",
            }, SERVICE.MINIMAX_H3_PROMPT_MODE_MAX_LENGTHS["T2VA"]),
        )
        for payload, expected in cases:
            with self.subTest(surface=payload.get("surface"), purpose=payload.get("purpose")):
                captured = self.capture_budget(payload)
                self.assertEqual(captured["max_length"], expected)

    def test_supports_negative_prompt_defaults_true(self):
        base = self.long_art_base()
        candidate = base.replace("明亮象牙白宫廷空间", "柔和不过曝的象牙白宫廷空间")
        assistant = SERVICE.PromptAssistant()
        prompts = []

        def generate(prompt: str, **kwargs):
            prompts.append(prompt)
            return self.patch_output(self.patch(
                "P01",
                "明亮象牙白宫廷空间",
                "柔和不过曝的象牙白宫廷空间",
            ))

        assistant.generate = generate
        result = assistant.optimize_prompt({
            "surface": "art",
            "prompt": base,
            "requirements": "背景过曝，降低背景高光",
        })
        self.assertEqual(len(prompts), 1)
        self.assertIn("只输出严格 JSON", prompts[0])
        self.assertEqual(result["positivePrompt"], candidate)
        self.assertTrue(result["negativePrompt"])

    def test_supports_negative_prompt_false_returns_positive_only(self):
        base = self.long_art_base()
        candidate = base.replace("明亮象牙白宫廷空间", "柔和不过曝的象牙白宫廷空间")
        assistant = SERVICE.PromptAssistant()
        captured = {}

        def generate(prompt: str, **kwargs):
            captured["prompt"] = prompt
            return self.patch_output(self.patch(
                "P01",
                "明亮象牙白宫廷空间",
                "柔和不过曝的象牙白宫廷空间",
            ))

        assistant.generate = generate
        result = assistant.optimize_prompt({
            "surface": "art",
            "prompt": base,
            "requirements": "背景过曝，降低背景高光",
            "supportsNegativePrompt": False,
        })
        self.assertIn("只输出严格 JSON", captured["prompt"])
        self.assertIn("target_quote", captured["prompt"])
        self.assertEqual(result["positivePrompt"], candidate)
        self.assertIn("避免真人摄影", result["positivePrompt"])
        self.assertEqual(result["negativePrompt"], "")
        self.assertEqual(result["rawOutput"], candidate)

    def test_unchanged_art_edit_triggers_one_repair_and_applies_instruction(self):
        base = self.long_art_base()
        repaired = base.replace(
            "明亮象牙白宫廷空间",
            "明亮但不过曝的象牙白宫廷空间，压低纯白高光并恢复背景层次",
        )
        source_quote = "明亮象牙白宫廷空间"
        replacement = "明亮但不过曝的象牙白宫廷空间，压低纯白高光并恢复背景层次"
        outputs = [
            self.patch_output(self.patch("P01", source_quote, source_quote)),
            self.patch_output(self.patch("P01", source_quote, replacement)),
        ]
        calls = []
        assistant = SERVICE.PromptAssistant()

        def generate(prompt: str, **kwargs):
            calls.append({"prompt": prompt, **kwargs})
            return outputs[len(calls) - 1]

        assistant.generate = generate
        result = assistant.optimize_prompt({
            "surface": "art",
            "purpose": "optimize",
            "prompt": base,
            "requirements": "用户本次修改要求（最高优先级）：背景过于曝光",
            "supportsNegativePrompt": False,
        })

        self.assertEqual(len(calls), 2)
        self.assertIn("patch-json-or-anchor-invalid", calls[1]["prompt"])
        self.assertIn("上一次不合格 JSON", calls[1]["prompt"])
        self.assertIn("背景过于曝光", calls[0]["prompt"])
        self.assertEqual(calls[0]["max_length"], SERVICE.ORDINARY_ART_PROMPT_PATCH_MAX_LENGTH)
        self.assertEqual(calls[1]["max_length"], SERVICE.ORDINARY_ART_PROMPT_PATCH_MAX_LENGTH)
        self.assertEqual(result["positivePrompt"], repaired)
        self.assertEqual(result["negativePrompt"], "")

    def test_second_unchanged_art_edit_raises_specific_bounded_error(self):
        base = self.long_art_base()
        assistant = SERVICE.PromptAssistant()
        calls = []

        def generate(prompt: str, **kwargs):
            calls.append(prompt)
            return self.patch_output(self.patch(
                "P01",
                "明亮象牙白宫廷空间",
                "明亮象牙白宫廷空间",
            ))

        assistant.generate = generate
        with self.assertRaises(SERVICE.OrdinaryArtPromptEditNotAppliedError) as raised:
            assistant.optimize_prompt({
                "surface": "art",
                "purpose": "optimize",
                "prompt": base,
                "requirements": "用户本次修改要求（最高优先级）：背景过于曝光",
                "supportsNegativePrompt": False,
            })

        self.assertEqual(len(calls), 2)
        self.assertEqual(raised.exception.code, "art-prompt-edit-not-applied")
        self.assertEqual(raised.exception.diagnostics["failureClass"], "application")

    def test_patch_merge_preserves_unedited_crlf_and_spaces_byte_for_byte(self):
        base = (
            "  主体：两位成年女性，身份保持。  \r\n\r\n"
            "背景：象牙白宫廷高光过亮。 \r\n\r\n"
            "  要求：保留丝绸帷幔与雕花屏风。  "
        )
        output = self.patch_output(self.patch(
            "P02",
            "象牙白宫廷高光过亮",
            "象牙白宫廷明亮但曝光受控",
        ))
        merged = SERVICE.apply_ordinary_art_patch_output(
            base,
            "用户本次修改要求（最高优先级）：背景过曝，降低背景高光",
            output,
        )
        self.assertEqual(
            merged,
            (
                "  主体：两位成年女性，身份保持。  \r\n\r\n"
                "背景：象牙白宫廷明亮但曝光受控。 \r\n\r\n"
                "  要求：保留丝绸帷幔与雕花屏风。  "
            ),
        )

    def test_patch_rejects_unknown_duplicate_overlap_extra_and_noop(self):
        requirements = "用户本次修改要求（最高优先级）：背景过曝，降低背景高光"
        ordinary_base = "背景：高光过亮。\n\n要求：保留人物身份。"
        repeated_base = "背景高光过亮，背景高光过亮。"
        overlap_base = "背景高光过亮。"
        cases = (
            (
                "unknown segment",
                ordinary_base,
                self.patch_output(self.patch("P99", "高光过亮", "曝光受控")),
            ),
            (
                "duplicate quote",
                repeated_base,
                self.patch_output(self.patch("P01", "背景高光过亮", "背景曝光受控")),
            ),
            (
                "overlapping quotes",
                overlap_base,
                self.patch_output(
                    self.patch("P01", "背景高光", "背景柔光"),
                    self.patch("P01", "高光过亮", "曝光受控"),
                ),
            ),
            (
                "top-level extra key",
                ordinary_base,
                self.patch_output(
                    self.patch("P01", "高光过亮", "曝光受控"),
                    note="不允许的额外字段",
                ),
            ),
            (
                "no-op",
                ordinary_base,
                self.patch_output(self.patch("P01", "高光过亮", "高光过亮")),
            ),
            (
                "wrong replacement type",
                ordinary_base,
                json.dumps({
                    "patches": [{
                        "segment_id": "P01",
                        "target_quote": "高光过亮",
                        "replacement": {"text": "曝光受控"},
                    }],
                }, ensure_ascii=False),
            ),
        )
        for label, base, output in cases:
            with self.subTest(case=label):
                self.assertEqual(
                    SERVICE.apply_ordinary_art_patch_output(base, requirements, output),
                    "",
                )

    def test_patch_accepts_strict_bare_array_and_fenced_array(self):
        base = "背景：象牙白宫廷高光过亮。\n\n要求：保留人物身份。"
        requirements = "用户本次修改要求（最高优先级）：背景过曝，降低背景高光"
        patch = self.patch("P01", "高光过亮", "明亮但曝光受控，高光不过曝")
        bare_array = json.dumps([patch], ensure_ascii=False, separators=(",", ":"))
        expected = "背景：象牙白宫廷明亮但曝光受控，高光不过曝。\n\n要求：保留人物身份。"

        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(base, requirements, bare_array),
            expected,
        )
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                base,
                requirements,
                f"```json\n{bare_array}\n```",
            ),
            expected,
        )

    def test_valid_patch_may_edit_a_non_recommended_segment(self):
        base = "背景：高光过亮。\n\n角色服装：红色长裙与银色首饰。"
        requirements = "用户本次修改要求（最高优先级）：背景过曝，降低背景高光"
        self.assertEqual(
            SERVICE.ordinary_art_patch_relevant_unit_ids(base, requirements),
            ["P01"],
        )
        output = self.patch_output(self.patch(
            "P02",
            "红色长裙",
            "青绿色长裙",
        ))
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(base, requirements, output),
            "背景：高光过亮。\n\n角色服装：青绿色长裙与银色首饰。",
        )

    def test_patch_rejects_english_meta_instruction_inside_prompt(self):
        base = "Adult woman. Background is overexposed. Chinese fantasy CG."
        requirements = "用户本次修改要求（最高优先级）：降低背景曝光"
        for replacement in (
            "Please lower the background exposure",
            "Need to reduce the highlights",
            "Should adjust the background lighting",
            "Controlled highlights; please lower the background exposure",
            "Controlled highlights, please lower the background exposure",
            "Controlled highlights.\nNeed to reduce the background exposure",
            "背景高光受控；请降低背景曝光",
            "背景高光受控，请降低背景曝光",
            "背景高光受控,需要调整背景曝光",
            "背景高光受控，应该降低背景曝光",
            "背景层次清晰。需要调整背景光线",
        ):
            with self.subTest(replacement=replacement):
                output = self.patch_output(self.patch(
                    "P01",
                    "Background is overexposed",
                    replacement,
                ))
                self.assertEqual(
                    SERVICE.apply_ordinary_art_patch_output(base, requirements, output),
                    "",
                )

        for replacement in (
            "Controlled highlights; background exposure remains natural and detailed",
            "Controlled highlights, background exposure remains natural and detailed",
            "A carefully adjusted background with controlled highlights",
            "背景高光受控；人物与背景层次清晰",
            "背景高光受控，人物与背景层次清晰",
            "调整后的背景曝光自然，高光细节完整",
        ):
            with self.subTest(final_state=replacement):
                output = self.patch_output(self.patch(
                    "P01",
                    "Background is overexposed",
                    replacement,
                ))
                self.assertTrue(
                    SERVICE.apply_ordinary_art_patch_output(base, requirements, output)
                )

    def test_patch_rejects_multi_patch_merged_no_op(self):
        base = "abcdef"
        requirements = "用户本次修改要求（最高优先级）：调整文本"
        output = self.patch_output(
            self.patch("P01", "abc", "ab"),
            self.patch("P01", "def", "cdef"),
        )
        diagnostics = {}
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(base, requirements, output, diagnostics),
            "",
        )
        self.assertEqual(diagnostics.get("failureReason"), "patch-merged-no-op")

    def test_patch_rejects_resource_placeholder_damage(self):
        base = "主体：__NOVAFLOW_RESOURCE_1__，身份和服装保持。\n\n背景：高光过亮。"
        output = self.patch_output(self.patch(
            "P01",
            "__NOVAFLOW_RESOURCE_1__",
            "普通人物参考",
        ))
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                base,
                "用户本次修改要求（最高优先级）：背景过曝，降低背景高光",
                output,
            ),
            "",
        )

        relocation_base = (
            "主体：__NOVAFLOW_RESOURCE_1__，身份和服装保持。\n\n"
            "背景：象牙白宫廷高光过亮。"
        )
        relocation_output = self.patch_output(
            self.patch("P01", "__NOVAFLOW_RESOURCE_1__", "人物参考"),
            self.patch("P02", "高光过亮", "高光受控 __NOVAFLOW_RESOURCE_1__"),
        )
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                relocation_base,
                "用户本次修改要求（最高优先级）：调整背景高光",
                relocation_output,
            ),
            "",
        )

    def test_patch_rejects_instruction_echo_and_large_content_collapse(self):
        base = "背景采用极简明亮的象牙白宫廷空间，仅保留丝绸帷幔和雕花屏风。"
        instruction = "用户本次修改要求（最高优先级）：背景过于曝光"
        echo_output = self.patch_output(self.patch(
            "P01",
            "背景采用极简明亮的象牙白宫廷空间",
            "背景过于曝光",
        ))
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(base, instruction, echo_output),
            "",
        )
        partial_echo_output = self.patch_output(self.patch(
            "P01",
            "背景采用极简明亮的象牙白宫廷空间",
            "背景过于曝光",
        ))
        diagnostics = {}
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                base,
                instruction,
                partial_echo_output,
                diagnostics,
            ),
            "",
        )
        self.assertEqual(diagnostics.get("failureReason"), "patch-repeats-problem-state")

        resolved_output = self.patch_output(self.patch(
            "P01",
            "背景采用极简明亮的象牙白宫廷空间",
            "背景仍保持明亮的象牙白宫廷空间，曝光和高光受控，帷幔与屏风细节清晰可见",
        ))
        self.assertTrue(
            SERVICE.apply_ordinary_art_patch_output(base, instruction, resolved_output)
        )

        vague_output = self.patch_output(self.patch(
            "P01",
            "背景采用极简明亮的象牙白宫廷空间",
            "背景采用柔和明亮的象牙白宫廷空间",
        ))
        diagnostics = {}
        vague_merged = SERVICE.apply_ordinary_art_patch_output(
            base,
            instruction,
            vague_output,
            diagnostics,
        )
        self.assertTrue(diagnostics.get("resolutionHintInjected"))
        self.assertIn("背景采用柔和明亮的象牙白宫廷空间", vague_merged)
        self.assertIn("曝光", vague_merged)
        self.assertIn("受控", vague_merged)
        self.assertIn("仅保留丝绸帷幔和雕花屏风", vague_merged)

        misleading_output = self.patch_output(self.patch(
            "P01",
            "背景采用极简明亮的象牙白宫廷空间",
            "背景曝光明显，呈现柔和明亮氛围",
        ))
        misleading_diagnostics = {}
        misleading_merged = SERVICE.apply_ordinary_art_patch_output(
            base,
            instruction,
            misleading_output,
            misleading_diagnostics,
        )
        self.assertTrue(misleading_diagnostics.get("resolutionHintInjected"))
        self.assertIn("受控", misleading_merged)

        too_bright_base = "画面太亮，高光丢失细节。"
        opposite_output = self.patch_output(self.patch(
            "P01",
            "画面太亮",
            "增加环境补光，整体更明亮",
        ))
        opposite_diagnostics = {}
        opposite_merged = SERVICE.apply_ordinary_art_patch_output(
            too_bright_base,
            "用户本次修改要求（最高优先级）：画面太亮",
            opposite_output,
            opposite_diagnostics,
        )
        self.assertEqual(opposite_merged, "")
        self.assertEqual(
            opposite_diagnostics.get("failureReason"),
            "patch-contradicts-problem-state",
        )

        too_dark_base = "背景过于暗沉，人物轮廓不清。"
        darker_output = self.patch_output(self.patch(
            "P01",
            "背景过于暗沉",
            "降低背景亮度，使环境更深暗",
        ))
        darker_diagnostics = {}
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                too_dark_base,
                "用户本次修改要求（最高优先级）：背景过于暗沉",
                darker_output,
                darker_diagnostics,
            ),
            "",
        )
        self.assertEqual(
            darker_diagnostics.get("failureReason"),
            "patch-contradicts-problem-state",
        )

        unrelated_lowering_output = self.patch_output(self.patch(
            "P01",
            "背景采用极简明亮的象牙白宫廷空间",
            "降低人物对比度，背景保持柔和明亮",
        ))
        unrelated_diagnostics = {}
        unrelated_merged = SERVICE.apply_ordinary_art_patch_output(
            base,
            instruction,
            unrelated_lowering_output,
            unrelated_diagnostics,
        )
        self.assertTrue(unrelated_diagnostics.get("resolutionHintInjected"))
        self.assertIn("曝光", unrelated_merged)

        valid_compound_cases = (
            (
                "画面太亮，高光丢失细节。",
                "用户本次修改要求（最高优先级）：画面太亮",
                "画面太亮",
                "增加高光细节，降低整体曝光",
            ),
            (
                "画面太亮，高光丢失细节。",
                "用户本次修改要求（最高优先级）：画面太亮",
                "画面太亮",
                "提高高光区域的细节可见度，曝光受控",
            ),
            (
                "画面太暗，暗部缺少纹理。",
                "用户本次修改要求（最高优先级）：画面太暗",
                "画面太暗",
                "降低暗部压暗强度，提升环境补光",
            ),
        )
        for compound_base, compound_instruction, target, replacement in valid_compound_cases:
            with self.subTest(replacement=replacement):
                output = self.patch_output(self.patch("P01", target, replacement))
                self.assertTrue(SERVICE.apply_ordinary_art_patch_output(
                    compound_base,
                    compound_instruction,
                    output,
                ))

        concrete_solutions = (
            (
                "画面太暗，人物轮廓不清。",
                "用户本次修改要求（最高优先级）：画面太暗",
                "画面太暗",
                "提升中间调与环境补光，暗部保留纹理",
            ),
            (
                "人物肤色偏红，服装保持不变。",
                "用户本次修改要求（最高优先级）：颜色偏红",
                "肤色偏红",
                "降低红色通道，肤色回归中性色温",
            ),
            (
                "服装细节不足，整体材质高级。",
                "用户本次修改要求（最高优先级）：细节不足",
                "细节不足",
                "增加刺绣纹样、发丝与珠宝反光",
            ),
        )
        for concrete_base, concrete_instruction, target, replacement in concrete_solutions:
            with self.subTest(replacement=replacement):
                output = self.patch_output(self.patch("P01", target, replacement))
                self.assertTrue(
                    SERVICE.apply_ordinary_art_patch_output(
                        concrete_base,
                        concrete_instruction,
                        output,
                    )
                )

        for replacement in (
            "太阳光照亮场景，暗部纹理丰富",
            "太空环境补光照亮场景，暗部纹理丰富",
        ):
            with self.subTest(false_marker_replacement=replacement):
                output = self.patch_output(self.patch("P01", "画面太暗", replacement))
                self.assertTrue(
                    SERVICE.apply_ordinary_art_patch_output(
                        "画面太暗，人物轮廓不清。",
                        "用户本次修改要求（最高优先级）：画面太暗",
                        output,
                    )
                )

        long_target = "背景宫廷帷幔屏风光线材质和空间层次必须完整保留，" * 8
        long_base = f"主体身份服装动作构图必须保持。{long_target}画面目标保持。"
        collapse_output = self.patch_output(self.patch(
            "P01",
            long_target,
            "柔和光线",
        ))
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                long_base,
                "用户本次修改要求（最高优先级）：背景光线更柔和",
                collapse_output,
            ),
            "",
        )

    def test_patch_accepts_verbatim_final_state_but_rejects_imperative_replacement(self):
        base = "背景：明亮宫廷与雕花屏风。"
        final_state = "柔和不过曝背景"
        valid_output = self.patch_output(self.patch(
            "P01",
            "明亮宫廷",
            final_state,
        ))
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                base,
                f"用户本次修改要求（最高优先级）：{final_state}",
                valid_output,
            ),
            "背景：柔和不过曝背景与雕花屏风。",
        )

        desired_problem_aesthetic = self.patch_output(self.patch(
            "P01",
            "明亮宫廷",
            "过度曝光的梦境宫廷",
        ))
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                base,
                "用户本次修改要求（最高优先级）：增加过度曝光的梦境效果",
                desired_problem_aesthetic,
            ),
            "背景：过度曝光的梦境宫廷与雕花屏风。",
        )

        imperative_output = self.patch_output(self.patch(
            "P01",
            "明亮宫廷",
            "将明亮宫廷改成柔和不过曝背景",
        ))
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                base,
                "用户本次修改要求（最高优先级）：背景过于明亮",
                imperative_output,
            ),
            "",
        )

    def test_patch_cannot_rename_or_drop_named_block_label(self):
        base = "主体保持。\n\n背景：明亮宫廷与雕花屏风。\n\n要求：角色必须明确成年。"
        rename_output = self.patch_output(self.patch(
            "P03",
            "要求：角色必须明确成年。",
            "规则：角色必须明确成年。",
        ))
        drop_output = self.patch_output(self.patch(
            "P02",
            "背景：明亮宫廷与雕花屏风。",
            "柔和不过曝的宫廷与雕花屏风。",
        ))
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(base, "优化画面", rename_output),
            "",
        )
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(base, "调整背景光线", drop_output),
            "",
        )

    def test_patch_allows_authorized_exact_phrase_deletion_only(self):
        base = "材质：柔润肌肤塑料皮肤丝绸质感。"
        output = self.patch_output(self.patch("P01", "塑料皮肤", ""))
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                base,
                "用户本次修改要求（最高优先级）：删除塑料皮肤",
                output,
            ),
            "材质：柔润肌肤丝绸质感。",
        )
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                base,
                "用户本次修改要求（最高优先级）：背景更柔和",
                output,
            ),
            "",
        )

    def test_explicit_keep_unchanged_instruction_allows_original_result(self):
        base = self.long_art_base()
        assistant = SERVICE.PromptAssistant()
        calls = []
        assistant.generate = lambda prompt, **_kwargs: calls.append(prompt) or base

        result = assistant.optimize_prompt({
            "surface": "art",
            "purpose": "optimize",
            "prompt": base,
            "requirements": "用户本次修改要求（最高优先级）：保持原样",
            "supportsNegativePrompt": False,
        })

        self.assertEqual(len(calls), 1)
        self.assertEqual(result["positivePrompt"], base)

        for instruction in ("保留人物和构图", "keep as is"):
            with self.subTest(instruction=instruction):
                self.assertTrue(SERVICE.ordinary_art_instruction_allows_unchanged(
                    f"用户本次修改要求（最高优先级）：{instruction}"
                ))

    def test_empty_renderer_edit_instruction_allows_unchanged_result(self):
        base = self.long_art_base()
        assistant = SERVICE.PromptAssistant()
        calls = []
        assistant.generate = lambda prompt, **_kwargs: calls.append(prompt) or base

        result = assistant.optimize_prompt({
            "surface": "art",
            "purpose": "optimize",
            "prompt": base,
            "requirements": (
                "提示词编辑模式：以完整原提示词为唯一底稿，未提及信息必须保留。\n"
                "高质量CG渲染约束：保持商业插画质量。"
            ),
            "supportsNegativePrompt": False,
        })

        self.assertEqual(SERVICE.ordinary_art_user_change_instruction(
            "提示词编辑模式：以完整原提示词为唯一底稿。\n高质量CG渲染约束。"
        ), "")
        self.assertEqual(len(calls), 1)
        self.assertEqual(result["positivePrompt"], base)

    def test_noop_patch_cannot_disguise_an_unchanged_positive_edit(self):
        base = self.long_art_base()
        repaired = base.replace(
            "明亮象牙白宫廷空间",
            "柔和不过曝的象牙白宫廷空间，降低纯白高光并恢复层次",
        )
        outputs = [
            self.patch_output(self.patch(
                "P01",
                "明亮象牙白宫廷空间",
                "明亮象牙白宫廷空间",
            )),
            self.patch_output(self.patch(
                "P01",
                "明亮象牙白宫廷空间",
                "柔和不过曝的象牙白宫廷空间，降低纯白高光并恢复层次",
            )),
        ]
        calls = []
        assistant = SERVICE.PromptAssistant()

        def generate(prompt: str, **kwargs):
            calls.append(prompt)
            return outputs[len(calls) - 1]

        assistant.generate = generate
        result = assistant.optimize_prompt({
            "surface": "art",
            "purpose": "optimize",
            "prompt": base,
            "requirements": "用户本次修改要求（最高优先级）：背景过于曝光",
            "supportsNegativePrompt": False,
        })

        self.assertEqual(len(calls), 2)
        self.assertIn("patch-json-or-anchor-invalid", calls[1])
        self.assertEqual(result["positivePrompt"], repaired)

    def test_priority_block_loss_is_repaired_once_from_original_base(self):
        priority_block = "要求：两位角色必须明确成年，四只手结构正确且归属明确。"
        base = f"{self.long_art_base()}\n\n{priority_block}"
        requirements = "背景过曝，降低背景高光，但保留人物和其余全部设定"
        repaired = base.replace("明亮象牙白宫廷空间", "柔和不过曝的象牙白宫廷空间")
        outputs = [
            self.patch_output(self.patch(
                "P02",
                priority_block,
                "背景亮度柔和并降低高光。",
            )),
            self.patch_output(self.patch(
                "P01",
                "明亮象牙白宫廷空间",
                "柔和不过曝的象牙白宫廷空间",
            )),
        ]
        calls = []
        assistant = SERVICE.PromptAssistant()

        def generate(prompt: str, **kwargs):
            calls.append({"prompt": prompt, **kwargs})
            return outputs[len(calls) - 1]

        assistant.generate = generate
        result = assistant.optimize_prompt({
            "surface": "art",
            "prompt": base,
            "requirements": requirements,
        })
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1]["seed"], 2)
        self.assertIn(self.long_art_base(), calls[1]["prompt"])
        self.assertIn(priority_block, calls[1]["prompt"])
        self.assertIn(requirements, calls[1]["prompt"])
        self.assertIn("上一次不合格 JSON", calls[1]["prompt"])
        self.assertIn("missing-blocks:要求", calls[1]["prompt"])
        self.assertEqual(calls[0]["max_length"], SERVICE.ORDINARY_ART_PROMPT_PATCH_MAX_LENGTH)
        self.assertEqual(calls[1]["max_length"], SERVICE.ORDINARY_ART_PROMPT_PATCH_MAX_LENGTH)
        self.assertEqual(result["positivePrompt"], repaired)

    def test_second_retention_failure_raises_bounded_contract_error(self):
        priority_block = "要求：两位角色必须明确成年，四只手结构正确且归属明确。"
        base = f"{self.long_art_base()}\n\n{priority_block}"
        assistant = SERVICE.PromptAssistant()
        calls = []

        def generate(prompt: str, **kwargs):
            calls.append(prompt)
            return self.patch_output(self.patch(
                "P02",
                priority_block,
                "背景亮度柔和并降低高光。",
            ))

        assistant.generate = generate
        with self.assertRaises(SERVICE.OrdinaryArtPromptRetentionError) as raised:
            assistant.optimize_prompt({
                "surface": "art",
                "prompt": base,
                "requirements": "背景过曝，降低背景高光",
            })
        self.assertEqual(len(calls), 2)
        self.assertEqual(raised.exception.code, "art-prompt-retention-failed")
        self.assertEqual(raised.exception.diagnostics["failureClass"], "retention")

    def test_positive_only_retention_repair_keeps_avoidance_block(self):
        avoidance_block = "避免：真人摄影、塑料皮肤、错误手指、多余手臂和复制脸。"
        core = self.long_art_base().replace(
            "避免真人摄影、3D渲染、塑料皮肤、错误手指、多余肢体和复制脸。",
            "皮肤保持柔润手绘质感。",
        )
        base = f"{core}\n\n{avoidance_block}"
        repaired = base.replace("明亮象牙白宫廷空间", "柔和不过曝的象牙白宫廷空间")
        outputs = [
            self.patch_output(self.patch(
                "P02",
                avoidance_block,
                "背景光线柔和并降低高光。",
            )),
            self.patch_output(self.patch(
                "P01",
                "明亮象牙白宫廷空间",
                "柔和不过曝的象牙白宫廷空间",
            )),
        ]
        calls = []
        assistant = SERVICE.PromptAssistant()

        def generate(prompt: str, **kwargs):
            calls.append(prompt)
            return outputs[len(calls) - 1]

        assistant.generate = generate
        result = assistant.optimize_prompt({
            "surface": "art",
            "prompt": base,
            "requirements": "背景过曝，降低背景高光",
            "supportsNegativePrompt": False,
        })
        self.assertEqual(len(calls), 2)
        self.assertIn("上一次不合格 JSON", calls[1])
        self.assertIn("target_quote", calls[1])
        self.assertIn("避免：真人摄影", result["positivePrompt"])
        self.assertEqual(result["negativePrompt"], "")
        self.assertEqual(result["rawOutput"], repaired)

    def test_renderer_user_change_line_excludes_appended_quality_policy(self):
        requirements = (
            "用户本次修改要求（最高优先级）：背景过曝，降低背景高光\n"
            "高质量CG协议：必须保留主体和构图。\n"
            "内部规则不得当作用户删除指令：删除要求块。"
        )
        self.assertEqual(
            SERVICE.ordinary_art_user_change_instruction(requirements),
            "背景过曝，降低背景高光",
        )
        self.assertEqual(SERVICE.ordinary_art_explicit_removal_targets(requirements), [])
        self.assertIn(
            "背景过曝",
            SERVICE.ordinary_art_retention_change_text(requirements),
        )
        self.assertNotIn(
            "高质量CG协议",
            SERVICE.ordinary_art_retention_change_text(requirements),
        )

    def test_patch_merge_preserves_tail_requirement_avoidance_and_goal_blocks(self):
        core = self.long_art_base().replace(
            "避免真人摄影、3D渲染、塑料皮肤、错误手指、多余肢体和复制脸。",
            "皮肤保持柔润手绘质感，避免塑料感。",
        )
        base = (
            f"{core}\n\n"
            "要求：两位角色必须明确成年，四只手结构正确且归属明确。\n\n"
            "避免：真人摄影、塑料皮肤、错误手指、多余手臂和复制脸。\n\n"
            "画面目标：高完成度中国幻想双女性角色游戏CG厚涂插画。"
        )
        repaired = base.replace("明亮象牙白宫廷空间", "柔和不过曝的象牙白宫廷空间")
        calls = []
        assistant = SERVICE.PromptAssistant()

        def generate(prompt: str, **kwargs):
            calls.append(prompt)
            return self.patch_output(self.patch(
                "P01",
                "明亮象牙白宫廷空间",
                "柔和不过曝的象牙白宫廷空间",
            ))

        assistant.generate = generate
        result = assistant.optimize_prompt({
            "surface": "art",
            "prompt": base,
            "requirements": (
                "用户本次修改要求（最高优先级）：背景过曝，降低背景高光\n"
                "高质量CG协议：自动补充光影与材质，但不是用户修改范围。"
            ),
        })
        self.assertEqual(len(calls), 1)
        self.assertEqual(result["positivePrompt"], repaired)
        self.assertIn("要求：两位角色必须明确成年", result["positivePrompt"])
        self.assertIn("避免：真人摄影", result["positivePrompt"])
        self.assertIn("画面目标：高完成度", result["positivePrompt"])

    def test_named_background_or_subject_block_can_be_replaced_without_repair(self):
        stable = self.long_art_base()
        cases = (
            (
                f"{stable}\n\n背景：明亮象牙白宫廷空间，丝绸帷幔和雕花屏风清晰可见。",
                f"{stable}\n\n背景：降低高光，形成柔和不过曝的象牙白宫廷层次。",
                "用户本次修改要求（最高优先级）：背景过曝，降低背景高光",
            ),
            (
                f"{stable}\n\n主体：一位红发盔甲战士站在画面中央，手持长剑。",
                f"{stable}\n\n主体：一位黑发白衣法师坐在画面中央，手持玉石法杖。",
                "用户本次修改要求（最高优先级）：将主体改为黑发白衣法师",
            ),
        )
        for base, candidate, requirements in cases:
            with self.subTest(requirements=requirements):
                self.assertEqual(
                    SERVICE.ordinary_art_retention_missing_blocks(
                        base,
                        requirements,
                        candidate,
                    ),
                    [],
                )
                self.assertEqual(
                    SERVICE.ordinary_art_retention_failure(
                        base,
                        requirements,
                        candidate,
                    ),
                    "",
                )

    def test_priority_block_is_not_implicitly_an_edit_target(self):
        stable = self.long_art_base()
        base = f"{stable}\n\n要求：两位角色明确成年，四只手归属清晰，避免融合肢体。"
        candidate = stable
        missing = SERVICE.ordinary_art_retention_missing_blocks(
            base,
            "用户本次修改要求（最高优先级）：要求文字更简洁",
            candidate,
        )
        self.assertEqual(missing, ["要求"])

    def test_priority_block_body_cannot_be_relocated_to_another_block(self):
        base = (
            "SCENE: moonlit palace with silk curtains.\n\n"
            "REQUIREMENTS: hands structurally correct and all subjects clearly adult."
        )
        output = self.patch_output(
            self.patch(
                "P01",
                "moonlit palace with silk curtains",
                "moonlit palace with silk curtains; hands structurally correct and all subjects clearly adult",
            ),
            self.patch(
                "P02",
                "hands structurally correct and all subjects clearly adult",
                "polished image quality and premium rendering",
            ),
        )
        diagnostics = {}
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                base,
                "用户本次修改要求（最高优先级）：背景更柔和",
                output,
                diagnostics,
            ),
            "",
        )
        self.assertIn("REQUIREMENTS", diagnostics.get("failureReason", ""))

    def test_priority_block_allows_same_name_fine_tune_and_explicit_deletion(self):
        base = (
            "SCENE: moonlit palace with silk curtains.\n\n"
            "REQUIREMENTS: hands structurally correct and all subjects clearly adult."
        )
        fine_tune = self.patch_output(self.patch(
            "P02",
            "all subjects clearly adult",
            "every subject is unmistakably adult",
        ))
        self.assertTrue(SERVICE.apply_ordinary_art_patch_output(
            base,
            "用户本次修改要求（最高优先级）：强调人物明确成年",
            fine_tune,
        ))

        delete_block = self.patch_output(self.patch(
            "P02",
            "REQUIREMENTS: hands structurally correct and all subjects clearly adult.",
            "",
        ))
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                base,
                "用户本次修改要求（最高优先级）：删除整个 REQUIREMENTS",
                delete_block,
            ),
            "SCENE: moonlit palace with silk curtains.\n\n",
        )

    def test_short_priority_body_rejects_unrelated_age_damage(self):
        base = "SCENE: close portrait.\n\nREQUIREMENT: 18+."
        output = self.patch_output(self.patch(
            "P02",
            "18+",
            "17-year-old",
        ))
        diagnostics = {}
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(
                base,
                "用户本次修改要求（最高优先级）：change portrait lighting",
                output,
                diagnostics,
            ),
            "",
        )
        self.assertIn("REQUIREMENT", diagnostics.get("failureReason", ""))

        explicit_age_change = self.patch_output(self.patch(
            "P02",
            "18+",
            "25+",
        ))
        self.assertTrue(SERVICE.apply_ordinary_art_patch_output(
            base,
            "用户本次修改要求（最高优先级）：change REQUIREMENT from 18+ to 25+",
            explicit_age_change,
        ))

    def test_explicit_user_removal_exempts_only_named_block(self):
        core = self.long_art_base()
        base = (
            f"{core}\n\n"
            "要求：保持两位成年角色和四只手归属明确。\n\n"
            "避免：真人摄影、塑料皮肤和复制脸。\n\n"
            "画面目标：高完成度中国幻想游戏CG。"
        )
        candidate = (
            f"{core}\n\n"
            "要求：保持两位成年角色和四只手归属明确。\n\n"
            "画面目标：高完成度中国幻想游戏CG。"
        )
        failure = SERVICE.ordinary_art_retention_failure(
            base,
            "用户本次修改要求（最高优先级）：删除避免部分",
            candidate,
        )
        self.assertEqual(failure, "")

    def test_partial_removal_wording_does_not_exempt_whole_block(self):
        stable = self.long_art_base().replace(
            "避免真人摄影、3D渲染、塑料皮肤、错误手指、多余肢体和复制脸。",
            "皮肤保持柔润手绘质感，避免塑料感。",
        )
        base = f"{stable}\n\n避免：真人摄影、塑料皮肤和复制脸。"
        candidate = stable
        missing = SERVICE.ordinary_art_retention_missing_blocks(
            base,
            "用户本次修改要求（最高优先级）：删除避免真人摄影",
            candidate,
        )
        self.assertEqual(missing, ["避免"])

    def test_label_words_in_plain_prose_do_not_count_as_candidate_block_labels(self):
        stable = self.long_art_base()
        base = f"{stable}\n\n画面目标：高完成度中国幻想游戏CG，丝绸与珠宝细节清晰。"
        candidate = f"{stable}\n普通段落提到画面目标这个词，但没有保留目标块。"
        missing = SERVICE.ordinary_art_retention_missing_blocks(
            base,
            "用户本次修改要求（最高优先级）：背景降低高光",
            candidate,
        )
        self.assertEqual(missing, ["画面目标"])

    def test_positive_only_keeps_natural_negative_space_phrase(self):
        base = self.long_art_base()
        candidate = f"{base}\n构图利用负向空间强化人物轮廓和视觉呼吸感。"
        assistant = SERVICE.PromptAssistant()
        anchor = "避免真人摄影、3D渲染、塑料皮肤、错误手指、多余肢体和复制脸。"
        assistant.generate = lambda _prompt, **_kwargs: self.patch_output(self.patch(
            "P01",
            anchor,
            f"{anchor}\n构图利用负向空间强化人物轮廓和视觉呼吸感。",
        ))
        result = assistant.optimize_prompt({
            "surface": "art",
            "prompt": base,
            "requirements": "构图增加留白",
            "supportsNegativePrompt": False,
        })
        self.assertIn("负向空间", result["positivePrompt"])
        self.assertEqual(result["negativePrompt"], "")
        self.assertEqual(result["rawOutput"], candidate)

    def test_positive_only_folds_violating_negative_line_into_avoidance(self):
        base = self.long_art_base()
        output = f"正向：{base}\n负向：过曝, 塑料皮肤, 多余肢体"
        assistant = SERVICE.PromptAssistant()
        assistant.generate = lambda _prompt, **_kwargs: output
        result = assistant.optimize_prompt({
            "surface": "art",
            "prompt": base,
            "requirements": "保持原样",
            "supportsNegativePrompt": False,
        })
        self.assertIn("避免：过曝, 塑料皮肤, 多余肢体", result["positivePrompt"])
        self.assertEqual(result["negativePrompt"], "")
        self.assertEqual(result["rawOutput"], result["positivePrompt"])

    def test_core_minor_gate_ignores_locally_negated_mentions(self):
        negated_examples = (
            "主体：无未成年人。",
            "主体：没有17岁男人。",
            "主体：不含未成年角色。",
            "主体：不包含任何儿童。",
            "主体：不涉及17岁角色。",
            "主体：禁止出现未成年人。",
            "主体：避免描绘17岁男人。",
            "主体：排除所有未成年人。",
            "主体：不得有17岁角色。",
            "主体：严禁未成年主体。",
            "主体：拒绝使用17岁人物。",
            "任何未成年人相关内容仍然禁止",
            "SUBJECT: no minors.",
            "SUBJECT: not a 17-year-old man.",
            "SUBJECT: without underage characters.",
            "SUBJECT: exclude minors.",
            "SUBJECT: avoid children.",
            "SUBJECT: prohibit 17-year-old men.",
            "SUBJECT: forbid minors.",
            "SUBJECT: minors are not allowed.",
            "17-year-old characters are prohibited.",
        )
        for text in negated_examples:
            with self.subTest(text=text):
                self.assertFalse(SERVICE.ordinary_art_core_affirmative_minor_present(text))

    def test_core_minor_gate_keeps_affirmative_and_property_negation_evidence(self):
        affirmative_examples = (
            "主体：17岁男人裸体躺在床上。",
            "SUBJECT: a 17-year-old man lying on the bed.",
            "主体：没有穿衣服的17岁男人躺在床上。",
            "17岁男人禁止裸体",
            "SUBJECT: a 17-year-old man without clothes.",
            "SUBJECT: a not fully clothed 17-year-old man.",
            "a 17-year-old man is prohibited from being nude",
            "a 17-year-old man is not allowed to be nude",
        )
        for text in affirmative_examples:
            with self.subTest(text=text):
                self.assertTrue(SERVICE.ordinary_art_core_affirmative_minor_present(text))

    def test_core_minor_gate_rejects_affirmative_match_beside_negated_match(self):
        mixed_examples = (
            "主体：不包含未成年人，但另有一名17岁男人裸体躺在床上。",
            "SUBJECT: no minors; a 17-year-old man is lying on the bed.",
        )
        for text in mixed_examples:
            with self.subTest(text=text):
                self.assertTrue(SERVICE.ordinary_art_core_affirmative_minor_present(text))

    def test_animation_does_not_enter_art_retention_repair(self):
        assistant = SERVICE.PromptAssistant()
        calls = []

        def generate(prompt: str, **kwargs):
            calls.append(prompt)
            return "正向：角色缓慢转身，固定镜头保持背景稳定。\n负向：动作抖动, 画面闪烁"

        assistant.generate = generate
        result = assistant.optimize_prompt({
            "surface": "animation",
            "prompt": self.long_art_base(),
            "requirements": "动作自然",
            "supportsNegativePrompt": False,
        })
        self.assertEqual(len(calls), 1)
        self.assertTrue(result["negativePrompt"])


if __name__ == "__main__":
    unittest.main()
