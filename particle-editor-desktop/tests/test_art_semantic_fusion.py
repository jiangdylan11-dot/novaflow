import importlib.util
import sys
import unittest
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
spec = importlib.util.spec_from_file_location('fusion_service', root / 'prompt-assistant-service.py')
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

class SemanticFusion(unittest.TestCase):
    def setUp(self):
        self.wrapped = (root / 'tests/fixtures/art-reverse-outdoor-fusion.txt').read_text(encoding='utf-8')
        self.instruction = '增加室外背景，提升画面质量和精美度。增加人物细节'
        self.source, self.user = service.art_semantic_fusion_input(self.wrapped, self.instruction)
        self.good = self.source.replace('纯白色背景，无其他物体，前景无遮挡，中景主体站立，后景无层次', '室外花园，前景花草与石径引导视线，中景主体站立，后景绿树与天空形成空间层次').replace('一名成年女性，', '一名成年女性，五官柔和清晰，指尖轮廓自然，花冠有细小雕纹，').replace('背景完全虚化浅景深', '背景适度柔化，保留花园层次')
    def test_legacy_carrier_and_plain_optimization_share_input(self):
        self.assertEqual(service.art_semantic_fusion_input(self.wrapped, ''), (self.source,self.instruction))
        self.assertEqual(service.art_semantic_fusion_input(self.source,'用户本次修改要求（最高优先级）：'+self.instruction), (self.source,self.instruction))
    def test_complete_fusion(self):
        self.assertEqual(service.art_semantic_fusion_failure(self.source,self.user,self.good),'')
    def test_rejects_conflict_and_partial_application(self):
        for bad in [self.source,self.wrapped,self.good.replace('五官柔和清晰，指尖轮廓自然，花冠有细小雕纹，',''),self.good.replace('室外花园，','纯白色背景，'),self.good.replace('[光线与色彩]','[新光线]')]:
            with self.subTest(candidate=bad):
                self.assertTrue(service.art_semantic_fusion_failure(self.source,self.user,bad))
    def test_resource_reference_loss_fails(self):
        self.assertTrue(service.art_semantic_fusion_failure(self.source+'\n__NOVAFLOW_IMAGE_1__',self.user,self.good))
    def test_background_focus_consistency_respects_explicit_blur(self):
        value = self.good.replace('背景适度柔化，保留花园层次', '背景完全虚化浅景深')
        self.assertNotIn('完全虚化', service.finalize_art_semantic_fusion(value,self.user))
        self.assertEqual(service.finalize_art_semantic_fusion(value,self.user+'，保留背景完全虚化'),value)
        self.assertEqual(service.finalize_art_semantic_fusion(value,'只增加人物细节'),value)

if __name__ == '__main__':
    unittest.main()
