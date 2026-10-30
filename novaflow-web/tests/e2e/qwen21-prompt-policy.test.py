import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "particle-editor-desktop"))
from prompt_assistant.qwen21_prompt_policy import policy_for, inject_policy, compile_agent_english


class QwenPolicyTests(unittest.TestCase):
    def test_modes_do_not_change_other_models_or_the_user_payload(self):
        template = "<|im_start|>system\nOriginal contract<|im_end|>\n<|im_start|>user\n{}<|im_end|>"
        self.assertEqual(inject_policy(template, {}), template)
        text = inject_policy(template, {"targetEngine": "qwen-2.1", "qwenPromptMode": "img2img"})
        self.assertIn("只强化用户点名的属性", text)
        self.assertIn("Original contract", text)
        self.assertEqual(text.split("<|im_start|>user", 1)[1], template.split("<|im_start|>user", 1)[1])

    def test_t2i_preserves_fixed_requirements_without_forcing_invented_inventory(self):
        text = policy_for({"targetEngine": "qwen-2.1", "qwenPromptMode": "txt2img"})
        for value in ["数量", "方位", "画面文字原文", "不擅自改尺寸", "不能为凑字数", "观察完成画面"]:
            self.assertIn(value, text)
        self.assertNotIn("400", text)

    def test_english_execution_is_opt_in_and_keeps_chinese_display_and_literal_text(self):
        result = {"positivePrompt": '左侧两个红球，底部黑色标题“春日计划”。'}
        def never(*args, **kwargs):
            self.fail("Manual prompts must not be translated")
        self.assertIs(compile_agent_english({"targetEngine": "qwen-2.1"}, result, never), result)
        request = {"targetEngine": "qwen-2.1", "agentModelLanguage": "en"}
        model = 'Exactly two red balls on the left, black title “春日计划” centered at the bottom.'
        pair = compile_agent_english(request, result, lambda *a, **k: model)
        self.assertEqual(pair["modelPrompt"], model)
        self.assertEqual(pair["displayPrompt"], result["positivePrompt"])
        with self.assertRaises(ValueError):
            compile_agent_english(request, result, lambda *a, **k: 'Two red balls and the English title Spring plan at the bottom.')


if __name__ == "__main__":
    unittest.main()
