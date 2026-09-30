"""Exercise the shipped Python intake without loading GPU weights."""
import ast
from pathlib import Path
import unittest


class ReferenceIntakeTest(unittest.TestCase):
    def test_all_references_reach_vision_in_order(self):
        path = Path(__file__).resolve().parents[3] / 'particle-editor-desktop/prompt-assistant-service.py'
        tree = ast.parse(path.read_text(encoding='utf-8-sig'))
        fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == 'reverse_image_prompt')
        stop = next(i for i, n in enumerate(fn.body) if isinstance(n, ast.If) and isinstance(n.test, ast.Name) and n.test.id == 'minimax_h3_reverse_mode')
        fn.body = fn.body[:stop] + [ast.Return(value=ast.Name(id='image_items', ctx=ast.Load()))]
        scope = {
            'minimax_h3_reverse_mode_from_purpose': lambda _: False,
            'is_animation_prompt_payload': lambda _: False,
            'is_ui_design_prompt_payload': lambda p: p.get('surface') == 'ui-design',
            'current_prompt_from_payload': lambda _: '', 'clean_text': str,
            'data_url_to_tensor': lambda v: v or None,
        }
        exec(compile(ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[])), str(path), 'exec'), scope)
        for surface in ['art', 'ui-design']:
            with self.subTest(surface=surface):
                images = [{'dataUrl': str(i), 'label': f'图{i+1}'} for i in range(16)]
                actual = scope['reverse_image_prompt'](None, {'surface': surface, 'images': images})
                self.assertEqual([r['tensor'] for r in actual], [r['dataUrl'] for r in images])
                self.assertEqual([r['label'] for r in actual], [r['label'] for r in images])
                with self.assertRaisesRegex(ValueError, '未截断'):
                    scope['reverse_image_prompt'](None, {'images': [images[0], {}]})


if __name__ == '__main__':
    unittest.main()
