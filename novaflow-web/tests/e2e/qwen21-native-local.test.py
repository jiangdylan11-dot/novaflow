import json
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'particle-editor-desktop'))
from prompt_assistant.qwen21_prompt_policy import compile_agent_native


class NativeLocalTests(unittest.TestCase):
    def setUp(self):
        self.payload = {'promptContract': 'qwen21-native-rewrite-v3', 'surface': 'art',
                        'purpose': 'optimize', 'targetEngine': 'qwen-2.1', 'qwenPromptMode': 'txt2img',
                        'currentPrompt': '两只红色的猫在左下角，标题“春日”。',
                        'supportsNegativePrompt': True, 'negativePrompt': '模糊'}
        self.pair = {'display_prompt': '两只红色的猫在画面左下角，标题“春日”，背景柔和而宁静。',
                     'model_prompt': 'Two red cats sit in the lower-left corner, with the title “春日” and a gentle quiet background.'}

    def test_one_call_and_result_contract(self):
        calls = []
        def generate(*args, **kwargs):
            calls.append((args, kwargs))
            return json.dumps(self.pair, ensure_ascii=False)
        result = compile_agent_native(self.payload, generate)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1]['trace_label'], 'qwen21NativeRewrite')
        self.assertEqual(result['positivePrompt'], self.pair['display_prompt'])
        self.assertEqual(result['displayPrompt'], self.pair['display_prompt'])
        self.assertEqual(result['modelPrompt'], self.pair['model_prompt'])
        self.assertEqual(result['modelPromptLanguage'], 'en')
        self.assertEqual(result['promptContract'], 'qwen21-native-rewrite-v3')
        self.assertEqual(result['modelPromptPolicy'], 'qwen21-native-rewrite-v3')
        self.assertEqual(result['translationValidation'], 'paired-prose-and-literals')
        self.assertTrue(result['hasNegativePrompt'])
        self.assertEqual(result['negativePrompt'], '模糊')

    def test_rejects_incomplete_or_inconsistent_output(self):
        invalid = ['not json', json.dumps({'display_prompt': 'bad'}),
                   json.dumps({**self.pair, 'model_prompt': self.pair['model_prompt'].replace('春日', 'spring')}),
                   json.dumps({**self.pair, 'model_prompt': self.pair['model_prompt'].replace('Two red', 'Three blue')}),
                   json.dumps({**self.pair, 'model_prompt': self.pair['model_prompt'].replace('lower-left', 'upper-right')})]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                compile_agent_native(self.payload, lambda *a, **k: value)

    def test_scope_rejected_before_model_call(self):
        for change in ({'qwenPromptMode': 'img2img'}, {'nsfw': True}, {'surface': 'audio'},
                       {'currentPrompt': 'data:image/png;base64,AA=='}, {'currentPrompt': '__NOVAFLOW_RESOURCE_MENTION_1_0__'}, {'promptContract': 'old'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                compile_agent_native({**self.payload, **change}, lambda *a, **k: self.fail('model must not run'))

    def test_service_dispatch_uses_one_call_and_blocks_sensitive_child_input(self):
        root = Path(__file__).resolve().parents[3] / 'particle-editor-desktop'
        spec = importlib.util.spec_from_file_location('foart_native_test_service', root / 'prompt-assistant-service.py')
        service = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = service
        spec.loader.exec_module(service)
        class FakeAssistant:
            def __init__(self): self.calls = 0
            def generate(self, *args, **kwargs):
                self.calls += 1
                return json.dumps(self_pair, ensure_ascii=False)
            def optimize_prompt(self, payload):
                raise AssertionError('native contract must not invoke legacy pipeline')
        self_pair = self.pair
        fake = FakeAssistant()
        with patch.object(service, 'assistant', fake):
            result = service._handle_request({**self.payload, 'command': 'optimizePrompt'})
            self.assertEqual(result['modelPrompt'], self.pair['model_prompt'])
            self.assertEqual(fake.calls, 1)
            with self.assertRaises(Exception):
                service._handle_request({**self.payload, 'command': 'optimizePrompt', 'currentPrompt': '八岁小女孩赤裸的身体'})
            self.assertEqual(fake.calls, 1)


if __name__ == '__main__':
    unittest.main()
