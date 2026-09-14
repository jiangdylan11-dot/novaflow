"""Translation must preserve edit verbs, bindings, timing and literal speech."""
import ast
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from prompt_assistant.h3_prompt_enhance import validate_reference

# Exercise the production method without importing GPU dependencies.
module = ast.parse((ROOT / 'prompt-assistant-service.py').read_text(encoding='utf-8-sig'))
assistant_class = next(n for n in module.body if isinstance(n, ast.ClassDef) and n.name == 'PromptAssistant')
method = next(n for n in assistant_class.body if isinstance(n, ast.FunctionDef) and n.name == 'translate_h3_reference')
scope = {'json': json, 're': re, 'validate_h3_reference': validate_reference}
exec(compile(ast.Module(body=[method], type_ignores=[]), str(ROOT / 'prompt-assistant-service.py'), 'exec'), scope)

FIELDS = {
    'subject_definitions': '<Subject 1>：外观来自 <Picture 1>，动作来自 <Video 1>。\n<Video 1>：原始视频。',
    'summary': '[video editing + reference generation] The target video is an edited version of <Video 1>. 把 <Video 1> 中的金币替换成 <Subject 1>，保持背景。',
    'retention_analysis': '<Subject 1>: attribute_transfer - 保留图片外观。\n<Video 1>: partially_preserved - 保留背景和运动。',
    'detailed_description': '[Shot 1] <Subject 1> 按原视频旋转，角色说“你好”。在1.500秒呈现侧面。',
    'overall_soundscape': 'N/A', 'non_diegetic_music': 'N/A',
}
TRANSLATIONS = {
    '外观来自 TOKEN_0，动作来自 TOKEN_1。': 'Appearance from TOKEN_0; motion from TOKEN_1.',
    '原始视频。': 'The source video.',
    '把 TOKEN_0 中的金币替换成 TOKEN_1，保持背景。': 'Replace the coin in TOKEN_0 with TOKEN_1, keeping the background.',
    '保留图片外观。': 'Keep the image appearance.',
    '保留背景和运动。': 'Preserve background and motion.',
    '按原视频旋转，角色说TOKEN_0。在1.500秒呈现侧面。': 'Rotate as in the source video; the character says TOKEN_0. Show the side at 1.5 seconds.',
}


class TranslationTest(unittest.TestCase):
    def run_translation(self, corrupt=None):
        calls = []
        class FakeAssistant:
            translate = scope['translate_h3_reference']
            def generate(self, request, **kwargs):
                pending = json.loads(request.split('Input JSON:\n', 1)[1])
                calls.append(pending)
                result = {key: TRANSLATIONS[value] for key, value in pending.items()}
                if len(calls) == 1 and corrupt:
                    for key, value in pending.items():
                        if value.startswith('把 '):
                            result[key] = corrupt(result[key])
                return json.dumps(result)
        result = FakeAssistant().translate(json.dumps(FIELDS, ensure_ascii=False), 'Available resource labels: <Picture 1>; <Video 1>', 3)
        return json.loads(result['positivePrompt']), calls

    def test_full_clause_bindings_and_literal_dialogue_survive(self):
        pair, calls = self.run_translation()
        self.assertEqual(len(calls), 1)
        self.assertIn('Replace the coin in <Video 1> with <Subject 1>, keeping the background.', pair['modelPrompt'])
        self.assertIn('“你好”', pair['modelPrompt'])
        self.assertIn('1.5 seconds', pair['modelPrompt'])
        self.assertIn('把 <Video 1> 中的金币替换成 <Subject 1>', pair['displayPrompt'])

    def test_bad_translation_retries_only_the_failed_clause(self):
        for corrupt in (lambda value: value.replace('Replace', 'Show'), lambda value: value.replace('TOKEN_1', 'TOKEN_7'), lambda value: '照抄中文'):
            with self.subTest(corrupt=corrupt):
                pair, calls = self.run_translation(corrupt)
                self.assertEqual(len(calls), 2)
                self.assertEqual(len(calls[1]), 1)
                self.assertIn('Replace the coin', pair['modelPrompt'])


if __name__ == '__main__':
    unittest.main()
