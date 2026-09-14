import importlib.util
import sys
import unittest
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
spec = importlib.util.spec_from_file_location('art_fusion_service', root / 'prompt-assistant-service.py')
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

class ArtRichnessFusion(unittest.TestCase):
    def test_concrete_facts_cover_open_request(self):
        self.assertEqual(service.ordinary_art_structured_requirement_ledger_failure(
            '增加参考图的画面丰富感。', ['前中后景层次递进，木材表面纹理清晰，暖色光影过渡细腻'], grounded_mapping=True), '')

    def test_padding_instructions_and_unrelated_facts_fail(self):
        for fact in ['画面更丰富、更高清、高质量', '建议增加材质纹理，提升光影层次', '蓝色陶瓷杯位于木桌右侧', '前景层次分明']:
            with self.subTest(fact=fact):
                self.assertTrue(service.ordinary_art_structured_requirement_ledger_failure(
                    '增加参考图的画面丰富感。', [fact], grounded_mapping=True))

    def test_other_edit_cannot_be_hidden_by_quality(self):
        self.assertTrue(service.ordinary_art_structured_requirement_ledger_failure(
            '增加参考图的画面丰富感；将杯子改为红色', ['前景层次分明，材质纹理细腻，光影过渡自然'], grounded_mapping=True))

    def test_copying_source_is_not_an_edit(self):
        fact = '前中后景层次递进，木材表面纹理清晰，暖色光影过渡细腻'
        self.assertTrue(service.ordinary_art_structured_requirement_ledger_failure(
            '增加参考图的画面丰富感。', [fact], grounded_mapping=True, source_prompt=fact))

    def test_actual_patch_preserves_unedited_source_and_rejects_padding(self):
        import json
        source = '一只橘猫坐在木桌上。\n\n背景是木质窗框与窗外花园。\n\n保持水彩风格，不增加其他动物。'
        unit = next(unit for unit in service.ordinary_art_patch_units(source) if '木质窗框' in unit['text'])
        quote = '背景是木质窗框与窗外花园。'
        requirements = '用户本次修改要求（最高优先级）：增加参考图的画面丰富感。'
        for replacement, accepted in [(quote + '木质窗框纹理清晰，前中后景层次递进，光影过渡自然。', True), (quote + '画面更丰富、更高清。', False)]:
            with self.subTest(replacement=replacement):
                raw = json.dumps({'patches':[{'segment_id':unit['id'],'target_quote':quote,'replacement':replacement}]},ensure_ascii=False)
                result = service.apply_ordinary_art_patch_output(source, requirements, raw)
                self.assertEqual(bool(result), accepted)
                if accepted:
                    self.assertEqual(result, source.replace(quote,replacement))

    def test_unlabelled_constraints_survive_model_whole_paragraph_rewrite(self):
        import json
        constraint = '保持猫、杯子、木桌和花园，不增加其他动物。'
        scene = '一只橘猫坐在木桌上，绿色眼睛看向窗外，前爪并拢。蓝色陶瓷杯放在木桌上。背景为花园。阳光从左侧照入，精细水彩插画。'
        source = scene + constraint
        unit = service.ordinary_art_patch_units(source)[0]
        candidate = scene.replace('阳光从左侧照入', '阳光从左侧照入，柔和光影过渡落在猫和杯子上')
        raw = json.dumps({'patches':[{'segment_id':unit['id'],'target_quote':source,'replacement':candidate}]},ensure_ascii=False)
        result = service.apply_ordinary_art_patch_output(source,'增加画面丰富感',raw)
        self.assertTrue(result)
        self.assertIn(constraint, result)
        self.assertIn('柔和光影过渡', result)

if __name__ == '__main__':
    unittest.main()
