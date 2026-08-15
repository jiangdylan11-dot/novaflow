from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path


DESKTOP_ROOT = Path(__file__).resolve().parents[1]
SERVICE_PATH = DESKTOP_ROOT / "prompt-assistant-service.py"
sys.path.insert(0, str(DESKTOP_ROOT))
SPEC = importlib.util.spec_from_file_location(
    "novaflow_prompt_assistant_service_simple_quality",
    SERVICE_PATH,
)
SERVICE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(SERVICE)


class SimpleQualityClosureTests(unittest.TestCase):
    SOURCE = "一名成年女战士站在山谷中，电影级光影，细节清晰。"
    REQUIREMENTS = "增强材质、光影层次和画面质感"

    def close(self, candidate: str, **kwargs):
        diagnostics = {}
        result = SERVICE.apply_ordinary_art_simple_quality_closure(
            self.SOURCE,
            self.REQUIREMENTS,
            candidate,
            diagnostics,
            **kwargs,
        )
        return result, diagnostics

    def test_exact_three_domain_request_closes_every_missing_final_state(self):
        result, diagnostics = self.close("一名成年女战士稳健站在开阔山谷中。")
        self.assertEqual(
            diagnostics["appendedDomains"],
            ["material", "lighting", "quality"],
        )
        for phrase in SERVICE.ORDINARY_ART_SIMPLE_QUALITY_CLOSURE_PHRASES.values():
            self.assertIn(phrase, result)

    def test_existing_source_quality_only_receives_missing_domains(self):
        source = "一名成年女战士站在山谷中，材质与纹理细腻清晰，光影层次丰富。"
        diagnostics = {}
        result = SERVICE.apply_ordinary_art_simple_quality_closure(
            source,
            self.REQUIREMENTS,
            "一名成年女战士站在海边，天空出现飞鸟。",
            diagnostics,
        )
        self.assertEqual(diagnostics["appendedDomains"], ["quality"])
        self.assertEqual(result.count("材质与纹理细腻清晰"), 1)
        self.assertEqual(result.count("光影层次丰富"), 1)
        self.assertIn("画面质感精致，细节清晰，完成度高", result)

    def test_unproven_provider_background_delta_is_discarded(self):
        result, diagnostics = self.close(
            "一名成年女战士站在海边，背景增加飞鸟，夕阳为红色。"
        )
        self.assertTrue(diagnostics["providerDeltaDiscarded"])
        self.assertTrue(result.startswith(self.SOURCE))
        self.assertNotIn("海边", result)
        self.assertNotIn("飞鸟", result)
        self.assertNotIn("红色", result)

    def test_non_allowlisted_mixed_negative_comparative_and_mutation_requests_abstain(self):
        for instruction in (
            "增强背景质感",
            "增强材质并保持构图",
            "不要增强材质",
            "把材质改得更清晰",
            "增强红色材质",
            "增加细节",
            "材质、光影层次和画面质感",
        ):
            with self.subTest(instruction=instruction):
                self.assertEqual(
                    SERVICE.ordinary_art_simple_quality_closure_domains(
                        self.SOURCE, instruction
                    ),
                    [],
                )

    def test_noneligible_candidate_preserves_exact_whitespace(self):
        candidate = "  第一行保持前导空格。\r\n第二行保持 CRLF。  \n"
        diagnostics = {}
        result = SERVICE.apply_ordinary_art_simple_quality_closure(
            self.SOURCE,
            "增强背景质感",
            candidate,
            diagnostics,
        )
        self.assertFalse(diagnostics["eligible"])
        self.assertEqual(result, candidate)

    def test_resource_and_structured_prompts_never_enter_quality_closure(self):
        resource_source = "一名女战士，使用 __NOVAFLOW_IMAGE_1__ 作为服装参考。"
        self.assertEqual(
            SERVICE.ordinary_art_simple_quality_closure_domains(
                resource_source, self.REQUIREMENTS
            ),
            [],
        )
        structured_source = "[风格设定]\n媒介=数字绘画\n[主体物品]\n主体=成年女战士"
        self.assertEqual(
            SERVICE.ordinary_art_simple_quality_closure_domains(
                structured_source, self.REQUIREMENTS
            ),
            [],
        )
        result, diagnostics = self.close(
            "一名成年女战士稳健站在开阔山谷中。",
            prompt_schema="nf.art.prompt.v1",
        )
        self.assertFalse(diagnostics["eligible"])
        self.assertNotIn("材质与纹理细腻清晰", result)

    def test_existing_resource_and_retention_gates_still_fail_closed(self):
        source = "一名女战士参考 __NOVAFLOW_IMAGE_1__ 站立。"
        unit_id = SERVICE.ordinary_art_patch_units(source)[0]["id"]
        output = json.dumps({
            "patches": [{
                "segment_id": unit_id,
                "target_quote": source,
                "replacement": "一名女战士以稳健姿态站立。",
            }]
        }, ensure_ascii=False)
        self.assertEqual(
            SERVICE.apply_ordinary_art_patch_output(source, "增强画质", output),
            "",
        )

        hard_source = "要求：必须保留蓝色发饰。\n\n主体：站立。"
        diagnostics = {}
        result = SERVICE.apply_ordinary_art_simple_quality_closure(
            hard_source,
            "增强画质",
            "主体以稳健姿态站立。",
            diagnostics,
        )
        self.assertEqual(result, "")
        self.assertIn("missing", diagnostics["failureReason"])


if __name__ == "__main__":
    unittest.main()
