import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from prompt_assistant.h3_prompt_enhance import validate_enhancement, INSTRUCTION

spec = importlib.util.spec_from_file_location("h3_enhance_service", ROOT / "prompt-assistant-service.py")
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)
CASES = json.loads((Path(__file__).parent / "fixtures/h3-prompt-enhance-cases.json").read_text(encoding="utf-8"))


def wrap(text):
    return f"integrated_multimodal_description: [Shot 1] {text}\n\noverall_soundscape: N/A\n\nnon_diegetic_music: N/A"


class H3EnhancementTest(unittest.TestCase):
    def test_shared_cases(self):
        for case in CASES:
            with self.subTest(case["name"]):
                if case["ok"]:
                    self.assertEqual(validate_enhancement(wrap(case["result"]), case["source"], case.get("requirement", "")), wrap(case["result"]))
                else:
                    with self.assertRaises(ValueError):
                        validate_enhancement(wrap(case["result"]), case["source"], case.get("requirement", ""))

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
        self.assertIn(INSTRUCTION, calls[0][0])
        self.assertIn(INSTRUCTION, calls[1][0])
        self.assertIn("回到起始", result["positivePrompt"])
        self.assertIn("overall_soundscape:", result["positivePrompt"])

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


if __name__ == "__main__":
    unittest.main()
