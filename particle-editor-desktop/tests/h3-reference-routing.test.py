"""Regression: equivalent asset labels must not discard an AI source selection."""
import ast
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
module = ast.parse((ROOT / 'prompt-assistant-service.py').read_text(encoding='utf-8-sig'))
cls = next(n for n in module.body if isinstance(n, ast.ClassDef) and n.name == 'PromptAssistant')
method = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == 'route_h3_reference_sources')
scope = {'json': json, 're': re}
exec(compile(ast.Module(body=[method], type_ignores=[]), str(ROOT / 'prompt-assistant-service.py'), 'exec'), scope)


class RoutingTest(unittest.TestCase):
    def route(self, sources):
        class Assistant:
            route = scope['route_h3_reference_sources']
            calls = 0
            def generate(self, *args, **kwargs):
                self.calls += 1
                return json.dumps({'sources': sources, 'operation': 'video editing', 'changes': ['background', 'surface']})
        assistant = Assistant()
        result = assistant.route('只把背景改成紫色。', '', 'Available resource labels: <Picture 1>; <Video 1>')
        return result, assistant.calls

    def test_unbracketed_source_label_does_not_enable_an_unused_picture(self):
        (sources, policy), calls = self.route(['Video 1'])
        self.assertEqual(calls, 1)
        self.assertEqual(sources, ['<Video 1>'])
        self.assertEqual(policy, {'preserveBackground': False, 'preserveMotion': True, 'sameShapeAppearanceOnly': False})

    def test_selected_picture_keeps_its_identity(self):
        (sources, policy), calls = self.route(['参考图1', 'video 1'])
        self.assertEqual(sources, ['<Picture 1>', '<Video 1>'])
        self.assertTrue(policy['sameShapeAppearanceOnly'])

    def test_an_invented_asset_cannot_become_a_selected_reference(self):
        result, calls = self.route(['Picture 2'])
        self.assertEqual(result, (None, None))
        self.assertEqual(calls, 2)


if __name__ == '__main__':
    unittest.main()
