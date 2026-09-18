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
    def test_empty_instruction_must_enrich_not_echo(self):
        # An empty requirement box is still a request: an echoed draft is a failure.
        editor_preamble = '提示词编辑模式：以 prompt / currentPrompt 中的完整原提示词为语义底稿。'
        self.assertEqual(service.art_semantic_fusion_input(self.source, editor_preamble), (self.source, ''))
        enriched = self.source.replace(
            '一名成年女性，',
            '一名成年女性，五官柔和清晰，指尖轮廓自然，花冠有细小雕纹，',
        )
        self.assertEqual(service.art_semantic_fusion_failure(self.source, '', enriched), '')
        self.assertEqual(
            service.art_semantic_fusion_failure(self.source, '', self.source),
            '未补足视觉细节',
        )
        self.assertEqual(
            service.art_semantic_fusion_failure(
                self.source, '', self.source + '，画面更加精美，整体更丰富'
            ),
            '仅追加泛化质量词',
        )

    def test_layout_less_draft_is_normalized_to_five_sections(self):
        # 单图反推的五段版式是唯一版式：没有自带分段的底稿必须被规整过去。
        prose = '一个机器人站在台阶上，机器人的风格要和图2一样，整体图2做完背景保持不变。'
        self.assertFalse(service.art_prompt_uses_own_sections(prose))
        laid_out = '\n'.join([
            '[风格设定]', '机器人的风格要和图2一样，手绘渲染语言，暖调氛围，完成质感细腻。',
            '[主体物品]', '一个机器人站在台阶上，金属躯干与铆钉接缝，站姿稳健，青铜与青绿色材质。',
            '[环境背景]', '整体图2做完背景保持不变，台阶为承托面，前景花瓣，后景形成空间层次。',
            '[光线与色彩]', '左上方自然光，轮廓光柔和，青绿与暖黄为主辅色。',
            '[拍摄参数]', '中景全身，略低视角，中心构图，标准透视，浅景深。',
        ])
        self.assertEqual(service.art_semantic_fusion_failure(prose, '', laid_out), '')
        for why, bad in [
            ('仍是散文', prose + '，材质细腻，光影过渡自然。'),
            ('改了段名', laid_out.replace('[拍摄参数]', '[镜头]')),
            ('多了前言', '以下是结果：\n' + laid_out),
        ]:
            with self.subTest(case=why):
                self.assertIn(
                    service.art_semantic_fusion_failure(prose, '', bad),
                    ('未按五个固定分段输出', '五段正文前有多余内容'),
                )
        # 底稿自带分段时保持原有版式，不强加五段。
        self.assertTrue(service.art_prompt_uses_own_sections(self.source))

    def test_resource_reference_loss_fails(self):
        self.assertTrue(service.art_semantic_fusion_failure(self.source+'\n__NOVAFLOW_IMAGE_1__',self.user,self.good))
    def test_background_focus_consistency_respects_explicit_blur(self):
        value = self.good.replace('背景适度柔化，保留花园层次', '背景完全虚化浅景深')
        self.assertNotIn('完全虚化', service.finalize_art_semantic_fusion(value,self.user))
        self.assertEqual(service.finalize_art_semantic_fusion(value,self.user+'，保留背景完全虚化'),value)
        self.assertEqual(service.finalize_art_semantic_fusion(value,'只增加人物细节'),value)

if __name__ == '__main__':
    unittest.main()
