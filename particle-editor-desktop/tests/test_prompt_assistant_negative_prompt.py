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

    def test_robot_arms_are_no_person(self):
        robot = service.build_targeted_negative_prompt(
            '视频 动画 图生视频 机器人在花园里浇花', '机器人手持喷壶，手臂微微下压，壶嘴喷出水流',
        )
        self.assertFalse(set(PERSON_TERMS) & set(terms(robot)))
        girl = service.build_targeted_negative_prompt('视频 动画 图生视频 ', '双手紧握长剑，向前冲锋')
        self.assertIn('错误手部', terms(girl))

    def test_ui_backdrop_is_no_scene(self):
        ui = service.build_targeted_negative_prompt(
            '音乐播放器 App 的播放页，深色背景', '深灰背景，顶部是圆形专辑封面，底部是播放按钮',
        )
        self.assertTrue(set(UI_TERMS) <= set(terms(ui)))
        self.assertFalse({'透视错误', '空间混乱', '光影不一致'} & set(terms(ui)))
        # A singer's name on the page is text, not a person in the picture.
        player = service.build_targeted_negative_prompt('音乐播放器 App 的播放页', '封面下方是歌曲标题与歌手名')
        self.assertFalse({'错误解剖', '多余手指'} & set(terms(player)))
        art = service.build_targeted_negative_prompt('少女的背景是雪山', '少女站着', video=False)
        self.assertIn('透视错误', terms(art))

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

    def test_video_names_clipping(self):
        knight = service.build_targeted_negative_prompt('视频 动画 图生视频 骑士挥剑', '骑士挥动长剑向前冲锋')
        self.assertIn('穿模', terms(knight))
        self.assertIn('错误手部', terms(knight))
        still = service.build_targeted_negative_prompt('骑士持剑', '骑士持剑站立', video=False)
        self.assertNotIn('穿模', terms(still))

    def test_creatures_with_limbs_get_animal_words(self):
        for positive in ('一条紫绿相间的龙缓缓前行', '戴冠的蛇怪昂起头', '怪兽张开利爪'):
            with self.subTest(positive=positive):
                negative = service.build_targeted_negative_prompt('视频 动画 图生视频 ', positive)
                self.assertTrue({'错误解剖', '畸形肢体', '多余肢体'} <= set(terms(negative)))
        for positive in ('龙卷风席卷海面', '身穿龙袍的皇帝', '机械爪抓起零件'):
            with self.subTest(positive=positive):
                negative = service.build_targeted_negative_prompt('', positive, video=False)
                self.assertNotIn('多余肢体', terms(negative))

    def test_negatives_fit_the_art_picture(self):
        # A cat has no person's face.
        cat = service.build_targeted_negative_prompt('一只橘猫趴在窗台上', '[主体物品]\n一只橘猫趴在窗台上', video=False)
        self.assertNotIn('五官错位', terms(cat))
        self.assertIn('多余肢体', terms(cat))
        # A 美工 prompt's thing and place get the prop and scene words; a plain backdrop is no scene.
        trophy = ('[风格设定]\n3D渲染风格。\n\n[主体物品]\n一个金色奖杯，杯身浮雕一颗五角星。\n\n[环境背景]\n夜晚的颁奖舞台，深红色地毯。\n\n'
                  '[光线与色彩]\n聚光灯从正上方照下。\n\n[拍摄参数]\n近景，平视。')
        staged = terms(service.build_targeted_negative_prompt('图片 图生图 把奖杯放在颁奖舞台上 roleReference', trophy))
        self.assertTrue({'材质错误', '透视错误', '空间混乱', '光影不一致'} <= set(staged))
        self.assertFalse(set(PERSON_TERMS) & set(staged))
        plain = terms(service.build_targeted_negative_prompt('图片 图生图 roleReference', trophy.replace('夜晚的颁奖舞台，深红色地毯', '纯灰色背景')))
        self.assertIn('材质错误', plain)
        self.assertNotIn('透视错误', plain)
        # A person the word lists do not know is no thing.
        for subject in ('一位新娘提着白纱裙摆，微笑回眸。', '一名护士推着病床。', '一位宇航员站在月面，右手举起挥手。'):
            with self.subTest(subject=subject):
                self.assertNotIn('多余部件', terms(service.build_targeted_negative_prompt('图片 图生图 roleReference', trophy.replace('一个金色奖杯，杯身浮雕一颗五角星。', subject))))
        # A dragon ornament is no animal.
        for subject in ('一位武将，剑柄处有龙首雕饰', '一位武将，手持雕龙长剑'):
            with self.subTest(subject=subject):
                self.assertNotIn('animal', [item['name'] for item in service.detect_negative_categories('', subject)])
        self.assertIn('animal', [item['name'] for item in service.detect_negative_categories('', '一条巨龙盘旋在山顶')])
        # A soft background asked for in the positive: the negative asks for a sharp subject, not against blur.
        soft = terms(service.build_targeted_negative_prompt('一只猫', trophy.replace('近景，平视', '近景，平视，背景虚化')))
        self.assertIn('主体模糊', soft)
        self.assertNotIn('模糊', soft)
        self.assertNotIn('背景模糊', terms(service.build_targeted_negative_prompt('一只猫', '一只猫，浅景深', '背景模糊，噪点')))
        # A clause that negates the blur, the avoidance line and a blurry thing ask for none: 模糊 and the model's blur
        # words stay.
        for sharp in ('近景，平视，背景虚化不明显', '近景，平视，背景无虚化', '近景，平视，环境清晰', '近景，平视。\n避免模糊的画面',
                      '近景，平视，背景清晰，没有虚化', '近景，平视，避免背景虚化，环境清晰', '近景，平视，背景不做虚化', '近景，平视，不要背景虚化',
                      '近景，平视。\n避免：背景虚化，失焦', '近景，平视。\n避免出现模糊的画面', '近景，平视，窗外是模糊的雾气'):
            with self.subTest(sharp=sharp):
                negative = terms(service.build_targeted_negative_prompt('一只猫', trophy.replace('近景，平视', sharp), '背景模糊，失焦，构图杂乱'))
                self.assertIn('模糊', negative)
                self.assertIn('背景模糊', negative)
                self.assertNotIn('主体模糊', negative)
        # Video and UI keep their blur words; motion blur is a defect in any picture.
        video = terms(service.build_targeted_negative_prompt(
            '视频 动画 图生视频 让她转身', '少女在樱花树下缓缓转身，镜头缓慢推进，浅景深，背景虚化。', '运动模糊，画面闪烁，拖影，失焦'))
        self.assertTrue({'模糊', '运动模糊', '失焦'} <= set(video))
        self.assertNotIn('主体模糊', video)
        self.assertNotIn('主体模糊', terms(service.build_targeted_negative_prompt('UI 界面 布局 登录页 uiDesign', '登录页面，背景为模糊的毛玻璃效果，背景虚化')))
        self.assertIn('运动模糊', terms(service.build_targeted_negative_prompt('一只猫', '一只猫，背景虚化', '运动模糊，噪点')))
        # "未见任何人物或动物" says who is absent, both of them.
        castle = terms(service.build_targeted_negative_prompt(
            '一座漂浮在云海上的古代城堡', '[主体物品]\n一座古代城堡漂浮于云海之上，未见任何人物或动物。\n\n[环境背景]\n云海', video=False))
        self.assertFalse({'错误解剖', '多余手指', '多余肢体'} & set(castle))
        # Near-synonyms from the model keep one.
        plastic = terms(service.build_targeted_negative_prompt('一只猫', '一只猫', '塑料质感，塑料材质，噪点'))
        self.assertEqual(len({'塑料质感', '塑料材质'} & set(plastic)), 1)

    def test_near_synonyms_keep_one(self):
        negative = service.build_targeted_negative_prompt(
            '少女站在雪山顶的城堡前，手持长剑', '少女站在雪山顶的城堡前，手持长剑，披风飘动',
        )
        self.assertEqual(len({'结构畸形', '结构错误', '形状畸形'} & set(terms(negative))), 1)
        self.assertIn('材质错误', terms(negative))

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
