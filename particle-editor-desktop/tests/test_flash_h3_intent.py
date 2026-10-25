"""Flash H3 intent boundaries at the real business-to-native request seam; CPU only."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from prompt_assistant.flash_adapter import FlashAdapter

SPEC = importlib.util.spec_from_file_location("flash_h3_intent_service", ROOT / "prompt-assistant-service.py")
SERVICE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVICE)

# Exact source/requirements from the real Flash H3 text test that inserted an
# unrequested action and extra ambient sounds. No photo-specific blacklist.
SOURCE = "一位成年女性站在明亮的图书馆窗边，先低头翻开手中的书，再抬头看向窗外。固定中景，单镜头，不切镜头。"
REQUIREMENTS = "保留先翻书、再抬头看窗外的动作顺序，5秒内自然完成。不要对白，不要背景音乐，只保留轻微翻页声。"
RAW = (
    "概述：写实电影风格，中景，一位成年女性站在明亮的图书馆窗边，手中拿着书，身后可见书架。\n"
    "起始：镜头固定，成年女性低头翻开手中的书，手指沿书脊移动，书页展开。\n"
    "递进：她保持书本展开，缓缓抬头，视线由书页移向窗外。\n"
    "收束：成年女性抬头看向窗外，双手继续拿着展开的书，目光停在窗外。\n"
    "声音：书页展开时发出轻微翻页声。\n"
    "约束：固定中景，单镜头，不切镜头；无对白，无背景音乐。"
)
ENV = {"NOVAFLOW_PROMPT_ASSISTANT_BACKEND": "strata", "NOVAFLOW_FLASH_BASE_URL": "http://127.0.0.1:8198", "NOVAFLOW_FLASH_MODEL_ID": "verified-flash-h3"}


class NativeResponse:
    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def read(self, limit):
        value = {"model": ENV["NOVAFLOW_FLASH_MODEL_ID"], "choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": RAW}}],
                 "usage": {"prompt_tokens": 1700, "completion_tokens": 400, "total_tokens": 2100}}
        return json.dumps(value).encode("utf-8")[:limit]


class FlashH3IntentTest(unittest.TestCase):
    def test_exclusive_source_parser_keeps_explicit_multiple_sources_and_additions(self):
        cases = {
            "只保留轻微翻页声。": "轻微翻页声。",
            "仅允许雨声、轻微脚步声和衣料摩擦声。": "雨声、轻微脚步声、衣料摩擦声。",
            "只保留雨声，另外允许脚步声，不要背景音乐。": "雨声、脚步声。",
            "请音效仅保留海浪声与风声即可。": "海浪声、风声。",
        }
        for requirement, expected in cases.items():
            with self.subTest(requirement=requirement):
                self.assertEqual(SERVICE.minimax_h3_flash_exclusive_sound("人物站立。", None, requirement), expected)

    def test_nonexclusive_temporal_and_audio_reference_requests_are_not_flattened(self):
        for requirement in ("保留雨声并加入脚步声", "只增加脚步声", "不要只保留雨声", "只保留雨声，之后加入脚步声",
                            "只保留 <Audio 1> 的原声音", "只保留雨声，并使用音频2的对白", "仅允许音乐和风声"):
            with self.subTest(requirement=requirement):
                self.assertIsNone(SERVICE.minimax_h3_flash_exclusive_sound("人物站立。", None, requirement))

    def test_flash_sound_override_keeps_raw_and_exact_narrative_without_a_second_call(self):
        noisy = RAW.replace("声音：书页展开时发出轻微翻页声。", "声音：书页展开时发出轻微翻页声。安静的室内环境声。")
        official = "integrated_multimodal_description: [Shot 1] 一位成年女性站在明亮的图书馆窗边，双手拿着书。她先低头翻开手中的书，书页自然展开，手指停在页面边缘，再缓缓抬头看向窗外，视线由书页移向窗外远处。固定中景，单镜头，不切镜头。\n\noverall_soundscape: 纸页摩擦声与室内环境声。\n\nnon_diegetic_music: N/A"
        for output in (noisy, official):
            with self.subTest(official=output == official), patch.dict(os.environ, ENV, clear=True):
                assistant = SERVICE.PromptAssistant()
                assistant.generate = Mock(return_value=output)
                result = assistant.optimize_h3_base(SOURCE, REQUIREMENTS, "T2VA", 5)
                fields = SERVICE.parse_h3_base_fields(result["positivePrompt"])
                self.assertEqual(fields["overall_soundscape"], "轻微翻页声。")
                self.assertEqual(fields["non_diegetic_music"], "N/A")
                self.assertEqual(result["rawOutput"], output)
                self.assertEqual(assistant.generate.call_count, 1)
                if output == official:
                    self.assertEqual(fields["integrated_multimodal_description"], SERVICE.parse_h3_base_fields(official)["integrated_multimodal_description"])

    def test_separate_authorized_dialogue_stays_in_narrative_and_pe_audio_is_unchanged(self):
        source = '女子低头翻开书，然后抬头看向窗外，并说：“出发吧。”'
        requirement = "只保留轻微翻页声，另外允许对白，不要背景音乐。"
        official = 'integrated_multimodal_description: [Shot 1] 女子低头翻开书，缓缓抬头看向窗外，开口说话。(S1) 说：<d>[Chinese] 出发吧。</d>\n\noverall_soundscape: 纸页摩擦声与室内环境声。\n\nnon_diegetic_music: N/A'
        with patch.dict(os.environ, ENV, clear=True):
            assistant = SERVICE.PromptAssistant()
            assistant.generate = Mock(return_value=official)
            result = assistant.optimize_h3_base(source, requirement, "T2VA", 5)
            fields = SERVICE.parse_h3_base_fields(result["positivePrompt"])
            self.assertEqual(fields["overall_soundscape"], "轻微翻页声。")
            self.assertIn("<d>[Chinese] 出发吧。</d>", fields["integrated_multimodal_description"])
            self.assertEqual(result["rawOutput"], official)
            self.assertEqual(assistant.generate.call_count, 1)
        with patch.dict(os.environ, {"NOVAFLOW_PROMPT_ASSISTANT_BACKEND": "pe"}, clear=True):
            assistant = SERVICE.PromptAssistant()
            assistant.generate = Mock(return_value=official)
            result = assistant.optimize_h3_base(source, requirement, "T2VA", 5)
            self.assertEqual(SERVICE.parse_h3_base_fields(result["positivePrompt"])["overall_soundscape"], "纸页摩擦声与室内环境声。")
            self.assertEqual(result["rawOutput"], official)

    def test_actual_text_case_keeps_full_h3_protocol_and_adds_boundaries_in_native_system(self):
        with patch.dict(os.environ, ENV, clear=True), patch.object(SERVICE, "log_prompt_assistant_event"):
            adapter = FlashAdapter()
            adapter._opener = Mock()
            adapter._opener.open.return_value = NativeResponse()
            assistant = SERVICE.PromptAssistant()
            with patch.object(assistant, "qwen3_adapter", return_value=adapter):
                result = assistant.optimize_prompt({"purpose": "minimax-h3-prompt-enhance", "h3Mode": "T2VA", "durationSeconds": 5,
                                                    "currentPrompt": SOURCE, "requirements": REQUIREMENTS})
            self.assertEqual(adapter._opener.open.call_count, 1)
            body = json.loads(adapter._opener.open.call_args.args[0].data)
            self.assertEqual(body["messages"][0], {"role": "system", "content": SERVICE.MINIMAX_H3_WRITER_RULES + SERVICE.MINIMAX_H3_FLASH_INTENT_RULES})
            user = "\n".join(part["text"] for part in body["messages"][1]["content"] if part["type"] == "text")
            self.assertIn(SOURCE, user)
            self.assertIn(REQUIREMENTS, user)
            for old_field in ("概述：", "起始：", "递进：", "收束：", "声音：", "约束："):
                self.assertIn(old_field, user)
            self.assertNotIn("<|im_start|>", json.dumps(body))
            self.assertEqual(result["rawOutput"], RAW)
            self.assertTrue(result["positivePrompt"].startswith("integrated_multimodal_description: [Shot 1] "))
            self.assertIn("\n\noverall_soundscape:", result["positivePrompt"])
            self.assertTrue(result["positivePrompt"].endswith("\n\nnon_diegetic_music: N/A"))
            self.assertEqual(body["max_tokens"], 1536)  # Existing bounded Flash budget, unchanged.

    def test_explicit_pe_diagnostic_keeps_original_h3_system_and_user_protocol(self):
        with patch.dict(os.environ, {"NOVAFLOW_PROMPT_ASSISTANT_BACKEND": "pe"}, clear=True), patch.object(SERVICE, "log_prompt_assistant_event"):
            adapter = Mock()
            adapter.generate_parts.return_value = RAW
            adapter.last_generation_diagnostics = {}
            assistant = SERVICE.PromptAssistant()
            with patch.object(assistant, "qwen3_adapter", return_value=adapter):
                result = assistant.optimize_h3_base(SOURCE, REQUIREMENTS, "T2VA", 5)
            self.assertEqual(adapter.generate_parts.call_count, 1)
            call = adapter.generate_parts.call_args
            self.assertEqual(call.kwargs["system_text"], SERVICE.MINIMAX_H3_WRITER_RULES)
            self.assertNotIn("Flash 意图边界", call.kwargs["system_text"])
            self.assertIn(SOURCE, call.args[0][0])
            self.assertIn(REQUIREMENTS, call.args[0][0])
            self.assertEqual(result["rawOutput"], RAW)


if __name__ == "__main__":
    unittest.main()
