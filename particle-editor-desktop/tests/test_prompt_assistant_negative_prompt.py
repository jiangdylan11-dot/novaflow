import importlib.util
import sys
import unittest
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
spec = importlib.util.spec_from_file_location('negative_prompt_service', root / 'prompt-assistant-service.py')
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

VIDEO_TERMS = ('动作抖动', '画面闪烁', '身份漂移', '背景漂移')
PERSON_TERMS = ('错误解剖', '多余手指', '错误手部', '人物变形', '肢体扭曲')
UI_TERMS = ('布局混乱', '元素重叠', '按钮变形', '错误文字')


def terms(value):
    return value.split('，')


class TargetedNegativePrompt(unittest.TestCase):
    def test_still_art_never_gets_video_words(self):
        # 动作/镜头/飘动 describe a still picture; only a video surface asks for video words.
        positive = (
            '[风格设定]\n厚涂插画\n\n[主体物品]\n少女持剑的动作舒展，斗篷随风飘动\n\n'
            '[环境背景]\n雪山顶\n\n[光线与色彩]\n月光\n\n[拍摄参数]\n全身，镜头平视'
        )
        for negative in (
            service.build_targeted_negative_prompt('少女站在雪山顶', positive),
            service.build_targeted_negative_prompt('图片 图生图  roleReference', positive),
            service.build_targeted_negative_prompt('吉卜力动画风格的少女', positive, video=False),
        ):
            with self.subTest(negative=negative):
                self.assertFalse(set(VIDEO_TERMS) & set(terms(negative)))
                self.assertIn('错误解剖', terms(negative))

    def test_anatomy_words_need_a_person(self):
        for context, positive in (
            ('一个手机产品图', '白色背景上的手机，手持角度，镜头特写'),
            ('一只橘猫趴在窗台上', '[主体物品]\n一只橘猫，前爪并拢，手绘质感'),
            ('机器人', '机器人抬起机械手臂，金属外壳'),
            ('赛博朋克风格的城市夜景', '[主体物品]\n无明确主体人物，高楼与霓虹广告牌\n[环境背景]\n街道上没有其他人物'),
        ):
            with self.subTest(context=context):
                negative = service.build_targeted_negative_prompt(context, positive, video=False)
                self.assertFalse({'多余手指', '错误手部', '身体比例错误'} & set(terms(negative)))

    def test_ui_words_only_for_ui_context(self):
        art = service.build_targeted_negative_prompt('木质卡片与面板上的图标插画', '木质面板，卡片，菜单式排列的图标')
        self.assertFalse(set(UI_TERMS) & set(terms(art)))
        ui = service.build_targeted_negative_prompt('UI 界面 布局 ui-design-reference', '深蓝色登录页，居中卡片')
        self.assertTrue(set(UI_TERMS) <= set(terms(ui)))

    def test_video_keeps_video_words_and_anatomy_only_with_person(self):
        robot = service.build_targeted_negative_prompt('视频 动画 图生视频 机器人在雨中行走', '机器人抬起机械手臂，镜头缓慢推进')
        self.assertTrue(set(VIDEO_TERMS) <= set(terms(robot)))
        self.assertFalse(set(PERSON_TERMS) & set(terms(robot)))
        girl = service.build_targeted_negative_prompt('视频 动画 图生视频 少女转身', '少女缓慢转身，裙摆飘动')
        self.assertTrue(set(VIDEO_TERMS) <= set(terms(girl)))
        self.assertIn('人物变形', terms(girl))
        self.assertIn('错误解剖', terms(girl))

    def test_chinese_keywords_and_separators(self):
        negative = service.build_targeted_negative_prompt('一只猫', '一只猫')
        self.assertTrue(negative.startswith('低质量，模糊，'))
        self.assertTrue(negative.endswith('，水印，标志'))
        self.assertNotIn('Logo', negative)
        self.assertNotIn(', ', negative)
        # The logo guard still removes the keyword for pictures that keep visible text or a logo.
        self.assertEqual(service.remove_negative_prompt_keywords('低质量，水印，标志', {'logo'}), '低质量，水印')
        self.assertEqual(service.remove_negative_prompt_keywords('低质量, Logo', {'logo'}), '低质量')

    def test_model_keywords_fill_in_but_cannot_add_wrong_categories(self):
        negative = service.build_targeted_negative_prompt(
            '视频 动画 图生视频 机器人在雨中行走', '机器人抬起机械手臂',
            '穿模, 镜头突变, 节奏混乱, 人物变形, 布局混乱, Logo, low quality, 低�',
        )
        items = terms(negative)
        for kept in ('穿模', '镜头突变', '节奏混乱'):
            self.assertIn(kept, items)
        for dropped in ('人物变形', '布局混乱', 'Logo', 'low quality', '低�'):
            self.assertNotIn(dropped, items)
        self.assertLessEqual(len(items), service.NEGATIVE_MAX_COUNT)


if __name__ == '__main__':
    unittest.main()
