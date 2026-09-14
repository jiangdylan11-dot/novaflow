import importlib.util
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('h3_projection_service', ROOT / 'prompt-assistant-service.py')
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

RICH = '''[风格设定]
风格：数字插画；清晰线条
[主体物品]
主体1：长发精灵
主体1姿态：站立，双手自然下垂
[环境背景]
环境：森林
背景：树木
[光线与色彩]
光线：柔和侧光
颜色：绿色
[拍摄参数]
景别：中景
角度：平视
构图：主体居中'''

class ProjectionConsistencyTests(unittest.TestCase):
    def test_person_evidence_survives_appearance_field_projection(self):
        result = service.minimax_h3_project_faithful_rich_contract(RICH, 1)
        self.assertEqual(result['content_safety']['visible_person_count'], 1)
        self.assertNotEqual(result['content_safety']['age_assessment'], 'not_applicable')
        self.assertIn('站立', result['entities'][0]['pose'])

    def test_object_does_not_acquire_person_evidence(self):
        result = service.minimax_h3_project_faithful_rich_contract(
            RICH.replace('长发精灵', '木箱').replace('主体1姿态：站立，双手自然下垂', '主体1颜色：棕色'), 1)
        self.assertEqual(result['content_safety']['visible_person_count'], 0)
        self.assertEqual(result['content_safety']['age_assessment'], 'not_applicable')

    def test_category_with_unobserved_extent_is_uncertain_not_none_or_invented_full(self):
        # Exercise metadata reconciliation without creating a sensitive prompt.
        # Keep the downstream validator in place; intercept its input only.
        seen = []
        def capture(text):
            value = json.loads(text)
            seen.append(value)
            return value
        with patch.object(service, 'minimax_h3_sensitive_categories', return_value={'nudity'}), \
             patch.object(service, 'parse_minimax_h3_local_visual_contract', side_effect=capture):
            service.minimax_h3_project_faithful_rich_contract(RICH, 1)
        safety = seen[0]['content_safety']
        self.assertEqual(safety['body_exposure'], 'uncertain')
        self.assertIn('nudity', safety['signals'])
        self.assertNotEqual(safety['level'], 'safe')
        self.assertEqual(safety['age_assessment'], 'age_unverifiable')

if __name__ == '__main__':
    unittest.main()
