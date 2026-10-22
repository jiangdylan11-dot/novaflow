import importlib.util
import json
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[3] / 'particle-editor-desktop/prompt_assistant/art_direction.py'
spec = importlib.util.spec_from_file_location('art_direction', path)
direction = importlib.util.module_from_spec(spec)
spec.loader.exec_module(direction)


def valid(refs=None):
    return {'schema': direction.SCHEMA, 'summary': '冰系剑客', 'prompt': '冰系女剑客站在寒冰洞窟中，光照与材质统一。',
            'references': refs or [], 'preserve': [], 'exclude': [], 'clarification': ''}


class Assistant:
    def __init__(self, answers):
        self.answers = iter(answers)
        self.calls = []

    def generate(self, prompt, **kwargs):
        # Exercise the real ChatML format operation; JSON braces must survive.
        formatted = kwargs['llama_template'].format(prompt)
        self.calls.append((formatted, kwargs))
        return json.dumps(next(self.answers), ensure_ascii=False)


class DrawingDirection(unittest.TestCase):
    def test_short_text_has_zero_visual_references_and_preserves_the_words(self):
        model = Assistant([valid()])
        result = direction.plan(model, [], {'currentPrompt': '冰系女剑客', 'artContext': {'references': []}})
        self.assertEqual(result['artDirection']['references'], [])
        self.assertIn('ZERO reference images', model.calls[0][0])
        self.assertIn('冰系女剑客', model.calls[0][0])

    def test_active_original_numbers_are_not_compacted(self):
        refs = [{'source': n, 'uses': [{'role': 'subject', 'detail': '对应人物', 'samples': []}], 'omit': []} for n in [2, 5]]
        model = Assistant([valid(refs)])
        result = direction.plan(model, ['pixels-2', 'pixels-5'], {'artContext': {'references': [{'source': 2}, {'source': 5}]}})
        self.assertEqual([r['source'] for r in result['artDirection']['references']], [2, 5])
        self.assertIn('原始图5', model.calls[0][0])
        self.assertEqual(model.calls[0][1]['images'], ['pixels-2', 'pixels-5'])

    def test_invalid_visual_output_gets_one_bounded_repair(self):
        model = Assistant([valid(), valid()])
        result = direction.plan(model, ['pixels'], {'artContext': {'references': [{'source': 1}]}})
        self.assertIsNone(result['artDirection'])
        self.assertIn('遗漏', result['validationError'])
        self.assertEqual(len(model.calls), 2)

    def test_impossible_coordinates_are_rejected(self):
        refs = [{'source': 1, 'uses': [{'role': 'material', 'detail': '布料', 'box': [300, 0, 100, 1000]}]}]
        with self.assertRaisesRegex(ValueError, '区域'):
            direction.validate(valid(refs), [1])

    def test_style_regions_use_a_focused_real_image_grounding_request(self):
        bad = valid([{'source': 1, 'uses': [{'role': 'style', 'detail': '手绘线条', 'samples': []}], 'omit': []}])
        good = valid([{'source': 1, 'uses': [{'role': 'style', 'detail': '手绘线条', 'samples': [[0, 0, 100, 100], [200, 0, 300, 100], [400, 0, 500, 100]]}], 'omit': [[600, 0, 900, 400]]}])
        grounded = {'samples': good['references'][0]['uses'][0]['samples'], 'omit': good['references'][0]['omit'], 'technique': '粗细变化的手绘线条'}
        model = Assistant([bad, grounded])
        result = direction.plan(model, ['pixels'], {'artContext': {'references': [{'source': 1, 'roles': ['style']}]}})
        self.assertEqual(len(model.calls), 2)
        self.assertEqual(len(result['artDirection']['references'][0]['uses'][0]['samples']), 3)
        self.assertEqual(model.calls[1][1]['images'], ['pixels'])
        self.assertEqual(model.calls[1][1]['trace_label'], 'artStyleRegions')

    def test_review_compares_output_and_originals_without_claiming_an_invalid_verdict(self):
        model = Assistant([{'schema': 'nf.art.review.v1', 'pass': False, 'issues': ['姿势未采用'], 'repair': '右手抬起至肩部，其余内容保留'}])
        result = direction.review(model, ['result', 'subject', 'pose'], {'currentPrompt': '图1用图2姿势', 'artContext': {'references': [{'source': 0}, {'source': 1}, {'source': 2}], 'plan': {}}})
        self.assertFalse(result['artReview']['pass'])
        self.assertIn('GENERATED RESULT', model.calls[0][0])
        self.assertIn('ORIGINAL source 2', model.calls[0][0])
        broken = Assistant([{'schema': 'nf.art.review.v1', 'pass': False, 'issues': [], 'repair': ''}])
        with self.assertRaisesRegex(ValueError, '有效结论'):
            direction.review(broken, ['result'], {'artContext': {'references': [{'source': 0}]}})

    def test_pose_is_observed_again_from_its_actual_single_source(self):
        refs = [{'source': 1, 'uses': [{'role': 'subject', 'detail': '主体'}], 'omit': []},
                {'source': 2, 'uses': [{'role': 'pose', 'detail': '错误地重复了主体动作'}], 'omit': []}]
        model = Assistant([valid(refs), {'pose': '单腿站立，双手合十于胸前'}])
        result = direction.plan(model, ['male-pixels', 'tree-pose-pixels'], {'artContext': {'references': [{'source': 1}, {'source': 2}]}})
        self.assertEqual(result['artDirection']['references'][1]['uses'][0]['detail'], '单腿站立，双手合十于胸前')
        self.assertEqual(model.calls[1][1]['images'], ['tree-pose-pixels'])
        self.assertEqual(model.calls[1][1]['trace_label'], 'artPoseGeometry')


if __name__ == '__main__':
    unittest.main()
