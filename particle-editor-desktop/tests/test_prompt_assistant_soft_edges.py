from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
SPEC = importlib.util.spec_from_file_location("soft_edges_service", ROOT / "prompt-assistant-service.py")
SERVICE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVICE)


class SoftEdgeEditTests(unittest.TestCase):
    SOURCE = "成年女性角色，穿着蓝色比基尼，保留粉色长发、站姿和白色背景。"

    def test_screenshot_request_becomes_positive_final_state(self):
        for requirement in ("不要过黑过重的描边", "不要粗黑的描边", "描边不要太黑太重", "减轻黑色描边", "轮廓线细一点"):
            with self.subTest(requirement=requirement):
                result = SERVICE.ordinary_art_soft_edge_edit(self.SOURCE, requirement)
                self.assertTrue(result.startswith(self.SOURCE))
                self.assertIn(SERVICE.ORDINARY_ART_SOFT_EDGE_FINAL_STATE, result)
                self.assertEqual(SERVICE.ordinary_art_change_application_failure(self.SOURCE, requirement, result), "")
                self.assertEqual(SERVICE.ordinary_art_patch_priority_retention_failure(self.SOURCE, requirement, result), "")

    def test_renderer_policy_is_not_treated_as_user_intent(self):
        requirement = "用户本次修改要求（最高优先级）：不要过黑过重的描边\n提示词编辑模式：保留主体和构图"
        self.assertIn(SERVICE.ORDINARY_ART_SOFT_EDGE_FINAL_STATE, SERVICE.ordinary_art_soft_edge_edit(self.SOURCE, requirement))

    def test_mixed_negated_and_ambiguous_requests_use_normal_model_edit(self):
        for requirement in ("不要减轻描边", "保留粗黑描边", "不要过黑过重的描边并换成红色衣服", "不要增强材质", "去掉描边", "不要过黑过重的阴影"):
            self.assertEqual(SERVICE.ordinary_art_soft_edge_edit(self.SOURCE, requirement), "", requirement)

    def test_conflicting_styles_structured_and_resource_prompts_abstain(self):
        for source in (self.SOURCE + "使用粗黑描边。", "[风格]\n媒介=赛璐璐", "参考 __NOVAFLOW_IMAGE_1__ 绘制人物。"):
            self.assertEqual(SERVICE.ordinary_art_soft_edge_edit(source, "不要过黑过重的描边"), "")
        self.assertEqual(SERVICE.ordinary_art_soft_edge_edit(self.SOURCE, "不要过黑过重的描边", prompt_schema="nf.art.prompt.v1"), "")

    def test_repeat_does_not_accumulate_edge_clauses(self):
        first = SERVICE.ordinary_art_soft_edge_edit(self.SOURCE, "不要过黑过重的描边")
        self.assertEqual(SERVICE.ordinary_art_soft_edge_edit(first, "不要过黑过重的描边"), first)

    def test_actual_optimizer_route_writes_complete_prompt_without_model_noop(self):
        assistant = SERVICE.PromptAssistant()
        with mock.patch.object(assistant, "generate", side_effect=AssertionError("pure edge request must not depend on a model rewrite")):
            for negative in (True, False):
                result = assistant.optimize_prompt({
                    "surface": "art", "prompt": self.SOURCE,
                    "requirements": "不要过黑过重的描边", "supportsNegativePrompt": negative,
                })
                self.assertTrue(result["positivePrompt"].startswith(self.SOURCE))
                self.assertIn(SERVICE.ORDINARY_ART_SOFT_EDGE_FINAL_STATE, result["positivePrompt"])
                self.assertEqual(result["editContract"], SERVICE.ORDINARY_ART_EDIT_CONTRACT)
                self.assertEqual(bool(result["negativePrompt"]), negative)

    def test_noop_guard_is_not_disabled_for_other_edits(self):
        self.assertEqual(SERVICE.ordinary_art_change_application_failure(self.SOURCE, "换成红色泳装", self.SOURCE), "requested-change-not-applied:unchanged-candidate")



if __name__ == "__main__":
    unittest.main()
