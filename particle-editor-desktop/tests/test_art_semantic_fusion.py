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
            ('自创段名', laid_out.replace('[拍摄参数]', '[其他]')),
            ('长段前文', prose + '材质细腻，光影过渡自然，整体色调温暖，画面层次丰富，适合游戏宣传。\n' + laid_out),
        ]:
            with self.subTest(case=why):
                self.assertIn(
                    service.art_semantic_fusion_failure(prose, '', bad),
                    ('未按五个固定分段输出', '五段正文前有多余内容'),
                )
        # 标题写法只是版式细节：Qwen3 的同行标题、冒号、加粗、【】、近义段名和一句引导语都规整后通过。
        for why, variant in [
            ('标题同行', laid_out.replace(']\n', '] ')),
            ('标题带冒号', laid_out.replace(']\n', ']：\n')),
            ('加粗标题', '\n'.join('**' + line + '**' if line.startswith('[') else line for line in laid_out.split('\n'))),
            ('中文方括号', laid_out.replace('[', '【').replace(']', '】')),
            ('近义段名', laid_out.replace('[拍摄参数]', '[镜头参数]')),
            ('一句引导语', '以下是结果：\n' + laid_out),
        ]:
            with self.subTest(case=why):
                self.assertEqual(service.art_semantic_fusion_failure(prose, '', service.normalize_art_sections(variant)), '')
                self.assertEqual(service.art_five_section_failure(variant), '')

    def test_normalized_layout_is_canonical_and_readable(self):
        inline = '[风格设定] 水彩插画\n[主体物品]：一只橘猫\n**[环境背景]**\n窗台\n【光线与色彩】暖光\n[镜头参数]\n中景'
        self.assertEqual(
            service.normalize_art_sections(inline),
            '[风格设定]\n水彩插画\n\n[主体物品]\n一只橘猫\n\n[环境背景]\n窗台\n\n[光线与色彩]\n暖光\n\n[拍摄参数]\n中景',
        )
        # Own sections that are not the five keep their names; only the layout is tidied.
        self.assertEqual(service.normalize_art_sections('[角色] 少女\n[场景]：雪山'), '[角色]\n少女\n\n[场景]\n雪山')
        # A leaked [用户附加要求] section and a 负向 line never reach the prompt.
        finished = service.art_finish_model_prompt(
            '正向：' + inline + '\n[用户附加要求]\n要求 = "改成夜晚"\n负向：低质量'
        )
        self.assertNotIn('用户附加要求', finished)
        self.assertNotIn('负向', finished)
        self.assertEqual(service.art_five_section_failure(finished), '')

    def test_five_headerless_paragraphs_are_labelled_in_order(self):
        paragraphs = '水彩插画\n\n一只橘猫趴在窗台上\n\n木质窗台\n\n午后阳光，暖橙色\n\n中景平视'
        self.assertEqual(
            service.art_finish_model_prompt(paragraphs),
            '[风格设定]\n水彩插画\n\n[主体物品]\n一只橘猫趴在窗台上\n\n[环境背景]\n木质窗台\n\n[光线与色彩]\n午后阳光，暖橙色\n\n[拍摄参数]\n中景平视',
        )
        # Anything else stays prose and goes to the one repair.
        self.assertEqual(service.art_finish_model_prompt('一只橘猫\n\n窗台'), '一只橘猫\n\n窗台')

    def test_written_prompts_keep_only_what_the_picture_shows(self):
        text = (
            '[主体物品]\n一只橘猫端坐，无佩戴任何饰品或道具，全身橘色毛发\n\n'
            '[光线与色彩]\n光线柔和；无明显阴影。整体色调以图2的浅蓝色为主，无数光点\n\n'
            '[环境背景]\n无袖长裙挂在墙上，没有其他人物'
        )
        self.assertEqual(
            service.art_positive_only_wording(text),
            '[主体物品]\n一只橘猫端坐，全身橘色毛发\n\n'
            '[光线与色彩]\n光线柔和。整体色调以浅蓝色为主，无数光点\n\n'
            '[环境背景]\n无袖长裙挂在墙上',
        )

    def test_rewrite_drops_only_the_negations_the_model_added(self):
        source = '[环境背景]\n浅色背景，无其他物体'
        candidate = '[环境背景]\n浅色背景，无其他物体，无其他人物相伴，暖光'
        self.assertEqual(
            service.art_positive_only_wording(candidate, source),
            '[环境背景]\n浅色背景，无其他物体，暖光',
        )
        # Lines without a dropped clause are returned exactly as written.
        self.assertEqual(service.art_positive_only_wording('[主体物品]\n少女；站立', source), '[主体物品]\n少女；站立')

    def test_time_of_day_edit_must_drop_the_old_time(self):
        source = '一个穿红色斗篷的少女站在雪山顶，白天，晴朗'
        stale = service.normalize_art_sections(QWEN3_INLINE_SECTIONS.replace('静谧的夜晚氛围', '晴朗白天氛围'))
        self.assertEqual(service.art_semantic_fusion_failure(source, '改成夜晚；加上月光', stale), '仍保留冲突的旧描述：白天')
        self.assertIn('“白天”', str(service.OrdinaryArtPromptEditNotAppliedError('仍保留冲突的旧描述：白天')))
        fresh = service.normalize_art_sections(QWEN3_INLINE_SECTIONS)
        self.assertEqual(service.art_semantic_fusion_failure(source, '改成夜晚；加上月光', fresh), '')
        # Keeping a time the user did not change is fine.
        self.assertEqual(service.art_stale_time_of_day(source, '加上月光', stale), '')

    def test_edit_failure_message_names_the_reason(self):
        for reason, text in [
            ('未按五个固定分段输出', '五段版式'),
            ('未落实对应段落：环境背景', '[环境背景]'),
            ('未实际融合修改要求', '与原提示词相同'),
        ]:
            with self.subTest(reason=reason):
                error = service.OrdinaryArtPromptEditNotAppliedError(reason)
                self.assertIn(text, str(error))
                self.assertEqual(error.diagnostics['applicationReason'], reason)
        # 底稿自带分段时保持原有版式，不强加五段。
        self.assertTrue(service.art_prompt_uses_own_sections(self.source))

    def test_resource_reference_loss_fails(self):
        self.assertTrue(service.art_semantic_fusion_failure(self.source+'\n__NOVAFLOW_IMAGE_1__',self.user,self.good))
    def test_background_focus_consistency_respects_explicit_blur(self):
        value = self.good.replace('背景适度柔化，保留花园层次', '背景完全虚化浅景深')
        self.assertNotIn('完全虚化', service.finalize_art_semantic_fusion(value,self.user))
        self.assertEqual(service.finalize_art_semantic_fusion(value,self.user+'，保留背景完全虚化'),value)
        self.assertEqual(service.finalize_art_semantic_fusion(value,'只增加人物细节'),value)

QWEN3_INLINE_SECTIONS = (
    '[风格设定] 厚涂插画，静谧的夜晚氛围\n\n'
    '[主体物品] 一个穿红色斗篷的少女站在雪山顶，斗篷在夜风中微扬\n\n'
    '[环境背景] 夜晚的雪山顶，积雪覆盖的岩石，远处连绵雪峰\n\n'
    '[光线与色彩] 月光从左上方洒下，冷蓝夜色中斗篷的红色醒目\n\n'
    '[拍摄参数] 全身景别，平视，居中构图'
)


class Qwen3ArtFlows(unittest.TestCase):
    def test_rewrite_accepts_qwen3_inline_headers(self):
        # Qwen3 writes "[风格设定] 正文" on one line; the edit is kept and laid out, not thrown away.
        assistant = service.PromptAssistant()
        calls = []
        assistant.generate = lambda prompt, **kwargs: calls.append(prompt) or QWEN3_INLINE_SECTIONS
        result = assistant.optimize_prompt({
            'surface': 'art', 'purpose': 'optimize', 'prompt': '一个穿红色斗篷的少女站在雪山顶，白天，晴朗',
            'requirements': '用户本次修改要求（最高优先级）：改成夜晚；加上月光\n高完成度角色CG质量：线条纤细轻淡。\n基础质量由系统自动负责：人物增强面部。',
        })
        self.assertEqual(len(calls), 1)
        # The draft names no painting style, so the "厚涂插画" Qwen3 chose is dropped; lines end with 。.
        self.assertEqual(
            result['positivePrompt'],
            service.art_close_sentences(service.normalize_art_sections(QWEN3_INLINE_SECTIONS.replace('厚涂插画，', ''))),
        )
        self.assertTrue(result['positivePrompt'].startswith('[风格设定]\n静谧的夜晚氛围。'))
        self.assertIn('\n\n[主体物品]\n', result['positivePrompt'])
        # The director text is for the generator, never for the writer.
        self.assertNotIn('高完成度角色CG质量', calls[0])
        self.assertNotIn('基础质量由系统自动负责', calls[0])
        self.assertNotIn('动作抖动', result['negativePrompt'])

    def test_rewrite_never_invents_reference_mentions(self):
        # Live Qwen3 once ended every section with "@参考图" after reading the placeholder rule.
        tagged = QWEN3_INLINE_SECTIONS.replace('\n\n', '，@参考图\n\n') + '，@参考图'
        assistant = service.PromptAssistant()
        calls = []
        assistant.generate = lambda prompt, **kwargs: calls.append(prompt) or tagged
        result = assistant.optimize_prompt({
            'surface': 'art', 'prompt': '一个穿红色斗篷的少女站在雪山顶，白天，晴朗', 'requirements': '改成夜晚；加上月光',
        })
        self.assertNotIn('@参考图', result['positivePrompt'])
        self.assertNotIn('__NOVAFLOW_', calls[0])
        # A draft that does carry a reference keeps it, and only then is the model told about it.
        source = '一个穿红色斗篷的少女 __NOVAFLOW_IMAGE_1__ 站在雪山顶，白天，晴朗'
        kept = QWEN3_INLINE_SECTIONS.replace('一个穿红色斗篷的少女', '一个穿红色斗篷的少女 __NOVAFLOW_IMAGE_1__')
        assistant.generate = lambda prompt, **kwargs: calls.append(prompt) or kept
        result = assistant.optimize_prompt({'surface': 'art', 'prompt': source, 'requirements': '改成夜晚；加上月光'})
        self.assertIn('__NOVAFLOW_IMAGE_1__', result['positivePrompt'])
        self.assertIn('__NOVAFLOW_', calls[-1])

    def test_create_writes_five_clean_sections_from_the_user_request_only(self):
        requirements = (
            '用户本次创作要求（最高优先级）：一只橘猫趴在窗台上晒太阳\n'
            '提示词创作模式：当前没有原提示词；根据用户创作要求输出一份完整、可直接生图的提示词。\n'
            '高完成度角色CG质量：保持稳定重心和原有动作；线条纤细轻淡。只输出用户要求的纯画面内容，不添加游戏界面、操作按钮、菜单面板、Logo或水印。\n'
            '基础质量由系统自动负责：游戏 UI、图标和海报增强信息层级。'
        )
        output = (
            '**[风格设定]** 温暖的水彩插画\n'
            '**[主体物品]** 一只橘猫慵懒地趴在窗台上，眯着眼睛\n'
            '**[环境背景]** 木质窗台，窗外是绿植\n'
            '**[光线与色彩]** 午后阳光从窗外斜照进来，橙黄与暖白为主色\n'
            '**[拍摄参数]** 中景，平视，猫位于画面中央'
        )
        assistant = service.PromptAssistant()
        captured = {}
        def generate(prompt, **kwargs):
            captured.update(kwargs, prompt=prompt)
            return output
        assistant.generate = generate
        result = assistant.optimize_prompt({'surface': 'art', 'purpose': 'create', 'prompt': '', 'requirements': requirements})
        self.assertEqual(captured['max_length'], service.ART_CREATE_MAX_LENGTH)
        self.assertEqual(captured['trace_label'], 'artCreate')
        self.assertIn('一只橘猫趴在窗台上晒太阳', captured['prompt'])
        for director in ('高完成度角色CG质量', '基础质量由系统自动负责', '提示词创作模式', '登录'):
            self.assertNotIn(director, captured['prompt'])
        self.assertEqual(service.art_five_section_failure(result['positivePrompt']), '')
        self.assertEqual(result['positivePrompt'].count('\n\n'), 4)
        negative = result['negativePrompt']
        for wrong in ('动作抖动', '画面闪烁', '布局混乱', '元素重叠', '多余手指', 'Logo'):
            self.assertNotIn(wrong, negative)

    def test_create_repairs_a_prose_answer_once(self):
        assistant = service.PromptAssistant()
        outputs = ['一只橘猫趴在窗台上晒太阳，水彩风格。', QWEN3_INLINE_SECTIONS]
        calls = []
        assistant.generate = lambda prompt, **kwargs: calls.append((prompt, kwargs['trace_label'])) or outputs[len(calls) - 1]
        result = assistant.optimize_prompt({'surface': 'art', 'prompt': '', 'requirements': '一只橘猫趴在窗台上晒太阳'})
        self.assertEqual([label for _, label in calls], ['artCreate', 'artCreateRepair'])
        self.assertIn('每段标题单独一行', calls[1][0])
        self.assertEqual(service.art_five_section_failure(result['positivePrompt']), '')

    def reverse(self, images, requirements, output):
        original = service.data_url_to_tensor
        service.data_url_to_tensor = lambda _url: object()
        assistant = service.PromptAssistant()
        captured = {}
        def generate(prompt, **kwargs):
            captured.update(kwargs, prompt=prompt)
            return output
        assistant.generate = generate
        try:
            result = assistant.reverse_image_prompt({
                'purpose': 'roleReference', 'requirements': requirements,
                'images': [{'dataUrl': 'data:image/png;base64,AA==', 'role': role, 'slotType': role, 'label': f'图{i + 1}'}
                           for i, role in enumerate(images)],
            })
        finally:
            service.data_url_to_tensor = original
        return captured, result

    def test_style_transfer_takes_style_from_the_style_picture_only(self):
        output = (
            '[风格设定]\n水墨插画，粗犷墨线与水彩晕染，纸张纹理，整幅画面按这种画风重新绘制\n'
            '[主体物品]\n一位短发年轻女性，橙色短袖衬衫，军绿色短裤，背着双肩包，站在路中央\n'
            '[环境背景]\n乡间公路，两侧田野与远山\n'
            '[光线与色彩]\n晴天顺光；暖黄底色，红黑强对比\n'
            '[拍摄参数]\n全身，平视，人物居中'
        )
        captured, result = self.reverse(['subject', 'style'], '用户生成要求：画面改为夜晚', output)
        prompt = captured['prompt']
        self.assertEqual(captured['max_length'], service.ART_ROLE_REFERENCE_MAX_LENGTH)
        self.assertEqual(len(captured['images']), 2)
        self.assertIn('[风格设定]：只看图2', prompt)
        self.assertIn('[主体物品]：看图1', prompt)
        self.assertIn('水墨', prompt)
        self.assertIn('用户要求（优先于图片内容，写进相关段落，不单独成段）：画面改为夜晚', prompt)
        self.assertLess(prompt.index('用户要求（优先于图片内容'), prompt.index('[风格设定]\n……'))
        self.assertIn('[光线与色彩]：时间是夜晚：按夜晚写光源方向、软硬与明暗（主光来自月光或灯光，暗部加深，整体色调偏暗），不照搬图片里的光线；', prompt)
        self.assertNotIn('用户生成要求', prompt)
        # An answer that ignored "夜晚" is asked about once; if it still ignores it, the time is written in.
        self.assertEqual(captured['trace_label'], 'artRoleReferenceRepair')
        self.assertIn('用户要求“画面改为夜晚”没有写进结果', prompt)
        text = result['positivePrompt']
        # The style palette comes with one fixed clause that keeps the subject's own colours.
        self.assertEqual(text, service.art_close_sentences(service.art_positive_only_wording(service.normalize_art_sections(
            output.replace('[光线与色彩]\n', '[光线与色彩]\n夜晚，').replace('红黑强对比', '红黑强对比，主体原有颜色保持不变')))))
        self.assertEqual(service.art_five_section_failure(text), '')
        for leaked in ('补充约束', '用户生成要求', '严格保留主体图'):
            self.assertNotIn(leaked, text)
        self.assertNotIn('动作抖动', result['negativePrompt'])

    def test_role_reference_maps_each_role_to_its_sections(self):
        captured, result = self.reverse(['subject', 'style', 'background'], '', QWEN3_INLINE_SECTIONS)
        prompt = captured['prompt']
        self.assertIn('[环境背景]：只看图3', prompt)
        self.assertIn('图1原来的背景一律不写', prompt)
        self.assertIn('光线看图3', prompt)
        self.assertIn('主色与辅色都只从图2里取颜色', prompt)
        self.assertNotIn('作为整幅画面的配色基调', prompt)
        self.assertIn('[拍摄参数]：看图1', prompt)
        self.assertIn('到脚写全身，到膝盖或大腿写七分身，到腰写中景，到胸写近景', prompt)
        self.assertEqual(prompt.count('<|vision_start|><|image_pad|><|vision_end|>'), 3)
        self.assertEqual(service.art_five_section_failure(result['positivePrompt']), '')

    def test_role_reference_with_one_picture_reads_it_with_the_user_text_in_one_call(self):
        # The one AI 助手 action sends a lone reference as the subject of the same five-section call.
        requirements = '用户生成要求：用户提示词：穿红色斗篷的少女站在雪山顶\n用户补充要求：画面改为夜晚'
        captured, result = self.reverse(['subject'], requirements, QWEN3_INLINE_SECTIONS)
        prompt = captured['prompt']
        self.assertEqual(captured['trace_label'], 'artRoleReference')
        self.assertEqual(captured['max_length'], service.ART_ROLE_REFERENCE_MAX_LENGTH)
        self.assertEqual(len(captured['images']), 1)
        self.assertEqual(prompt.count('<|vision_start|><|image_pad|><|vision_end|>'), 1)
        self.assertIn('用户要求（优先于图片内容，写进相关段落，不单独成段）：', prompt)
        self.assertIn('穿红色斗篷的少女站在雪山顶', prompt)
        self.assertIn('画面改为夜晚', prompt)
        self.assertEqual(service.art_five_section_failure(result['positivePrompt']), '')

    def test_role_reference_sees_the_prompt_box_and_the_supplement_together(self):
        # The one AI 助手 action sends both texts; the vision call reads both, without their labels.
        requirements = '用户提示词：橘猫坐在大厅的地毯上，抬头看向镜头\n用户补充要求：画面改为夜晚'
        captured, _ = self.reverse(['subject', 'background'], requirements, QWEN3_INLINE_SECTIONS)
        prompt = captured['prompt']
        self.assertIn('用户要求（优先于图片内容，写进相关段落，不单独成段）：橘猫坐在大厅的地毯上，抬头看向镜头\n画面改为夜晚\n', prompt)
        self.assertIn('时间是夜晚', prompt)
        self.assertNotRegex(prompt, '用户提示词|用户补充要求')
        self.assertEqual(len(captured['images']), 2)
        # 单图反推 keeps all of it as the final constraint, within the 2000 characters the worker sends.
        self.assertTrue(service.append_rich_generation_requirements('[风格设定]\n写实', requirements).endswith(
            '[用户附加要求]\n要求 = "用户提示词：橘猫坐在大厅的地毯上，抬头看向镜头 用户补充要求：画面改为夜晚"'))
        self.assertTrue(service.append_rich_generation_requirements('写实', 'x' * 2600).endswith('\n要求 = "' + 'x' * 2000 + '"'))


class ArtPromptCleanup(unittest.TestCase):
    """Small deterministic fixes for what Qwen3 reliably writes despite the instructions."""

    def test_rewrite_drops_style_age_and_hair_nobody_asked_for(self):
        source = '一个穿红色斗篷的少女站在雪山顶，白天，晴朗'
        candidate = (
            '[风格设定]\n写实风格，高细节渲染，冷冽静谧的氛围\n\n'
            '[主体物品]\n一位穿红色斗篷的少女，独自站立，年龄约十六七岁，发色深褐，长发束于脑后\n\n'
            '[环境背景]\n夜晚的雪山之巅，远景是连绵雪峰'
        )
        cleaned = service.art_drop_invented_clauses(candidate, source, '改成夜晚；加上月光')
        self.assertEqual(cleaned, (
            '[风格设定]\n高细节渲染，冷冽静谧的氛围\n\n'
            '[主体物品]\n一位穿红色斗篷的少女，独自站立\n\n'
            '[环境背景]\n夜晚的雪山之巅，远景是连绵雪峰'
        ))
        # A style, age or hairstyle that the draft or the edit names stays.
        self.assertEqual(service.art_drop_invented_clauses(candidate, source + '，写实风格，十六岁，长发', '改成夜晚'), candidate)
        # A request for more detail may add hair; only the invented style goes.
        self.assertIn('发色深褐', service.art_drop_invented_clauses(candidate, source, '增加人物细节'))
        # A draft without a camera angle gets one angle only; a draft that names angles keeps them.
        camera = '[拍摄参数]\n中景平视构图，镜头轻微仰角突出雪山'
        self.assertEqual(service.art_drop_invented_clauses(camera, source, '改成夜晚'), '[拍摄参数]\n中景平视构图')
        self.assertEqual(service.art_drop_invented_clauses(camera, source + '，仰视', '改成夜晚'), camera)

    def test_scene_change_keeps_the_time_and_drops_the_reverse_note(self):
        source = '[环境背景]\n地点 = "纯白背景"\n空间层次 = "保持参考图现有前中后景关系"\n\n[光线与色彩]\n主光线 = "高光、明暗对比"'
        candidate = (
            '[环境背景]\n地点 = "海边"\n背景 = "海浪翻涌、礁石嶙峋、夕阳余晖洒在海面"\n'
            '空间层次 = "保持参考图现有前中后景关系，前景为武将，远景为海天交界处"\n\n'
            '[光线与色彩]\n主光线 = "高光、明暗对比，来自夕阳斜射"'
        )
        self.assertEqual(service.art_drop_invented_clauses(candidate, source, '把背景改成海边'), (
            '[环境背景]\n地点 = "海边"\n背景 = "海浪翻涌、礁石嶙峋"\n'
            '空间层次 = "前景为武将，远景为海天交界处"\n\n'
            '[光线与色彩]\n主光线 = "高光、明暗对比"'
        ))
        # A line is never emptied, and a draft with a reference picture keeps the note.
        alone = '[环境背景]\n空间层次 = "保持参考图现有前中后景关系"'
        self.assertEqual(service.art_drop_invented_clauses(alone, source, '把背景改成海边'), alone)
        self.assertIn('保持参考图现有', service.art_drop_invented_clauses(candidate, source + '\n__NOVAFLOW_IMAGE_1__', '把背景改成海边'))
        # A time the user asked for is kept.
        self.assertIn('夕阳', service.art_drop_invented_clauses(candidate, source, '把背景改成黄昏的海边'))

    def test_time_of_day_edit_writes_the_time(self):
        text = '[风格设定]\n静谧氛围\n\n[光线与色彩]\n月光从左上方斜射，冷调阴影'
        self.assertEqual(
            service.art_write_requested_time(text, '改成夜晚；加上月光'),
            '[风格设定]\n静谧氛围\n\n[光线与色彩]\n夜晚，月光从左上方斜射，冷调阴影',
        )
        self.assertEqual(service.art_write_requested_time(text.replace('月光', '夜色中月光'), '改成夜晚'), text.replace('月光', '夜色中月光'))
        self.assertEqual(service.art_write_requested_time(text, '加上月光'), text)
        self.assertIn('夜晚，月光', service.art_write_requested_time(text, '把白天改成夜晚'))
        keyed = '[光线与色彩]\n主光线 = "高光、明暗对比"'
        self.assertEqual(service.art_write_requested_time(keyed, '改成黄昏'), '[光线与色彩]\n主光线 = "黄昏，高光、明暗对比"')
        self.assertEqual(service.art_write_requested_time('少女站在雪山顶', '改成夜晚'), '夜晚，少女站在雪山顶')

    def test_dropped_negation_takes_its_but_along(self):
        self.assertEqual(
            service.art_positive_only_wording('[主体物品]\n主体为城市夜景，无明确人物，但可见高耸摩天楼'),
            '[主体物品]\n主体为城市夜景，可见高耸摩天楼',
        )
        self.assertEqual(service.art_positive_only_wording('[主体物品]\n高楼林立，但夜色很深'), '[主体物品]\n高楼林立，但夜色很深')
        self.assertEqual(
            service.art_positive_only_wording('[光线与色彩]\n整体色调以图2中的暖黄色为主'),
            '[光线与色彩]\n整体色调以暖黄色为主',
        )
        # A note that the picture has no subject is not something to draw either.
        self.assertEqual(
            service.art_positive_only_wording('[主体物品]\n城市夜景中无明确主体，聚焦于高耸的摩天楼群'),
            '[主体物品]\n聚焦于高耸的摩天楼群',
        )
        self.assertEqual(service.art_positive_only_wording('[主体物品]\n一架无人机悬停'), '[主体物品]\n一架无人机悬停')

    def test_one_camera_angle_and_no_blur_on_a_plain_backdrop(self):
        text = '[环境背景]\n纯色中性灰背景\n\n[拍摄参数]\n广角镜头俯拍，低角度仰视城市天际线，景深浅，背景虚化处理。'
        self.assertEqual(
            service.art_single_view_angle(text),
            '[环境背景]\n纯色中性灰背景\n\n[拍摄参数]\n广角镜头俯拍，景深浅，背景虚化处理。',
        )
        self.assertEqual(
            service.art_plain_background_focus(service.art_single_view_angle(text)),
            '[环境背景]\n纯色中性灰背景\n\n[拍摄参数]\n广角镜头俯拍。',
        )
        scene = text.replace('纯色中性灰背景', '秋日森林小路')
        self.assertEqual(service.art_plain_background_focus(scene), scene)

    def test_sentences_are_closed_but_key_value_lines_stay(self):
        self.assertEqual(
            service.art_close_sentences('[风格设定]\n古风插画，黄昏氛围\n\n[主体物品]\n一座城堡。\n景别 = "全身"'),
            '[风格设定]\n古风插画，黄昏氛围。\n\n[主体物品]\n一座城堡。\n景别 = "全身"',
        )

    def test_role_requirement_check(self):
        self.assertTrue(service.art_requirement_missing('画面改为夜晚', '[光线与色彩]\n柔光，暖米白'))
        self.assertFalse(service.art_requirement_missing('画面改为夜晚', '[光线与色彩]\n夜色中月光洒落'))
        # Moonlight answers the night; "夜晚" itself is written in afterwards, no repair needed.
        self.assertFalse(service.art_requirement_missing('画面改为夜晚', '[光线与色彩]\n主光来自上方的月光，整体偏暗'))
        self.assertTrue(service.art_requirement_missing('画面改为下雪', '[环境背景]\n地面铺满积雪'))
        self.assertFalse(service.art_requirement_missing('画面改为下雪', '[环境背景]\n雪花纷飞'))
        self.assertTrue(service.art_requirement_missing('背景换成海边', '[环境背景]\n乡间公路'))
        self.assertFalse(service.art_requirement_missing('背景换成海边', '[环境背景]\n海边沙滩'))
        self.assertFalse(service.art_requirement_missing('去掉背包', '[主体物品]\n短发少女'))
        self.assertFalse(service.art_requirement_missing('', '[主体物品]\n短发少女'))
        # A new background is written into the environment duty, not next to "看图1".
        request = service.art_role_reference_request(['subject', 'style'], '背景换成海边沙滩')
        self.assertIn('[环境背景]：按用户要求写新环境（背景换成海边沙滩）', request)
        self.assertNotIn('[环境背景]：看图1', request)

    def test_instructions_carry_no_copyable_rule_text(self):
        self.assertNotIn('清晰可辨', service.ART_SEMANTIC_FUSION_RULES)
        self.assertNotIn('一起调整', service.ART_SEMANTIC_FUSION_RULES)
        self.assertNotIn('承托面', service.ART_CREATE_INSTRUCTION)
        self.assertNotIn('没有人物时', service.ART_CREATE_INSTRUCTION)
        self.assertIn('视角只写一种', service.ART_CREATE_INSTRUCTION)
        self.assertIn('不添加底稿和修改要求都没有的', service.ART_OWN_SECTION_OUTPUT_RULE)
        # 创作 wording that came back in the prompt: "地面铺着地毯", "最醒目的建筑群", "远处保持清晰".
        for copied in ('地面、水面', '最醒目', '保持清晰'):
            self.assertNotIn(copied, service.ART_CREATE_INSTRUCTION)
        self.assertIn('以及画面下方是什么', service.ART_CREATE_INSTRUCTION)
        self.assertNotIn('主体下方', service.ART_CREATE_INSTRUCTION)
        self.assertNotIn('承托', service.ART_CREATE_INSTRUCTION)
        # A subject in one spot is framed whole; only a large scene gets a long shot.
        self.assertIn('时用全景', service.ART_CREATE_INSTRUCTION)
        self.assertIn('大场景', service.ART_CREATE_INSTRUCTION)
        # The rewrite keeps its own section guide.
        self.assertIn('脚下或下方的地面、水面或云层', service.ART_FIVE_SECTION_OUTPUT_RULE)

    def test_weather_edit_writes_the_weather_and_drops_the_sun(self):
        text = (
            '[环境背景]\n冬季雪林，枯枝挂雪，地面铺满积雪\n\n'
            '[光线与色彩]\n晴朗天空下，阳光穿透云层洒下冷白光，主色为雪白'
        )
        self.assertEqual(service.art_write_requested_weather(text, '改成冬天，下着雪'), (
            '[环境背景]\n雪花飘落，冬季雪林，枯枝挂雪，地面铺满积雪\n\n'
            '[光线与色彩]\n阳光穿透云层洒下冷白光，主色为雪白'
        ))
        # Snowfall already written: nothing is added.
        falling = text.replace('枯枝挂雪', '雪花纷飞')
        self.assertIn('[环境背景]\n冬季雪林，雪花纷飞', service.art_write_requested_weather(falling, '下着雪'))
        # The user's own strength is kept; fog goes in front of the environment too.
        self.assertIn('[环境背景]\n大雨，冬季雪林', service.art_write_requested_weather(text, '改成大雨'))
        self.assertIn('[环境背景]\n薄雾弥漫，冬季雪林', service.art_write_requested_weather(text, '加一点雾气'))
        # Removing weather, rain that has stopped, or no weather at all changes nothing.
        for instruction in ('去掉下雪', '不要下雨', '改成雨后的街道', '改成夜晚'):
            with self.subTest(instruction=instruction):
                self.assertEqual(service.art_write_requested_weather(text, instruction), text)
        # A key = "value" draft gets the words inside the quotes.
        keyed = '[环境背景]\n地点 = "海边"'
        self.assertEqual(service.art_write_requested_weather(keyed, '下雨'), '[环境背景]\n地点 = "细雨飘落，海边"')

    def test_rewrite_drops_weather_and_camera_blur_nobody_asked_for(self):
        source = '一位身穿银色铠甲的骑士骑着白马穿过秋天的森林，阳光透过金黄的树叶洒在小路上，写实摄影风格'
        candidate = (
            '[环境背景]\n秋天的森林，金黄落叶铺满小径，远景有薄雾笼罩的树影，桌面呈雾面质感\n\n'
            '[拍摄参数]\n中景平视构图，景深适中，背景虚化突出主体，画面留白自然'
        )
        cleaned = service.art_drop_invented_clauses(candidate, source, '改成水彩风格')
        self.assertEqual(cleaned, (
            '[环境背景]\n秋天的森林，金黄落叶铺满小径，桌面呈雾面质感\n\n'
            '[拍摄参数]\n中景平视构图，画面留白自然'
        ))
        # Fog the draft or the edit names stays; a photographic edit keeps its blur.
        self.assertIn('薄雾', service.art_drop_invented_clauses(candidate, source + '，薄雾', '改成水彩风格'))
        kept = service.art_drop_invented_clauses(candidate, source, '把背景改成海边')
        self.assertIn('景深适中，背景虚化突出主体', kept)
        # A blur the draft itself has is not the model's addition.
        self.assertIn('景深适中', service.art_drop_invented_clauses(candidate, source + '，景深适中', '改成水彩风格'))
        # A piece that carries the draft's own content is not dropped for its weather word.
        subject = '[主体物品]\n骑士骑着白马穿过雨中的秋天森林'
        self.assertEqual(service.art_drop_invented_clauses(subject, source, '改成水彩风格'), subject)

    def test_negation_after_a_place_is_dropped(self):
        self.assertEqual(
            service.art_positive_only_wording('[环境背景]\n城堡下方是云海，脚下无地面无水面，全为云层托举城堡'),
            '[环境背景]\n城堡下方是云海，全为云层托举城堡',
        )
        self.assertEqual(
            service.art_positive_only_wording('[环境背景]\n纯色背景，背景中没有其他物体'),
            '[环境背景]\n纯色背景',
        )
        self.assertEqual(
            service.art_positive_only_wording('[环境背景]\n云海翻涌，城堡下方无地面承托，仅由云气托举悬浮'),
            '[环境背景]\n云海翻涌，仅由云气托举悬浮',
        )
        # "面无表情" and "画面无比开阔" describe the picture.
        for kept in ('[主体物品]\n少女面无表情', '[环境背景]\n画面无比开阔，远山连绵'):
            with self.subTest(text=kept):
                self.assertEqual(service.art_positive_only_wording(kept), kept)

    def test_role_reference_cleanup_keeps_each_picture_to_its_sections(self):
        text = (
            '[风格设定]\n写实摄影，线条干净，材质肌理呈现细腻的毛发与织物纹理，整幅画面按这种画风重新绘制\n\n'
            '[主体物品]\n一只橘猫\n\n'
            '[环境背景]\n室内大厅\n\n'
            '[光线与色彩]\n主光源来自左前方，整体色调以暖黄色为主，辅以主体原有的金色与黑色，主体原有橙色保留于[主体物品]段\n\n'
            '[拍摄参数]\n全身景别，前景与背景有明显虚实对比，突出主体'
        )
        self.assertEqual(service.art_role_reference_cleanup(text, ['subject', 'style', 'background']), (
            '[风格设定]\n写实摄影，线条干净，整幅画面按这种画风重新绘制\n\n'
            '[主体物品]\n一只橘猫\n\n'
            '[环境背景]\n室内大厅\n\n'
            '[光线与色彩]\n主光源来自左前方，整体色调以暖黄色为主，主体原有颜色保持不变。\n\n'
            '[拍摄参数]\n全身景别，突出主体'
        ))
        # A keep-statement the model wrote stays and needs no fixed clause.
        kept = '[光线与色彩]\n整体色调以暖黄色为主，主体服装颜色保持橙色与军绿色不变'
        self.assertEqual(service.art_role_reference_cleanup(kept, ['subject', 'style']), kept)
        # A painted style picture drops the photographic blur; a photographic one keeps it.
        camera = '\n\n[拍摄参数]\n全身景别，平视视角，背景虚化处理，突出人物主体'
        painted = service.art_role_reference_cleanup('[风格设定]\n国潮插画风格，粗犷黑色勾线' + camera, ['subject', 'style'])
        self.assertIn('[拍摄参数]\n全身景别，平视视角，突出人物主体', painted)
        photo = service.art_role_reference_cleanup('[风格设定]\n写实摄影风格' + camera, ['subject', 'style'])
        self.assertIn('背景虚化处理', photo)
        # Without a style picture only the section names go; the subject's fur and the blur stay.
        alone = service.art_role_reference_cleanup(text, ['subject'])
        self.assertIn('毛发', alone)
        self.assertIn('虚实对比', alone)
        self.assertNotIn('[主体物品]段', alone)
        for echo in ('主体原有橙色写在主体物品中', '颜色见光线与色彩段', '颜色保留于【主体物品】'):
            with self.subTest(echo=echo):
                self.assertEqual(service.art_drop_section_mentions(f'[光线与色彩]\n暖黄色为主，{echo}'), '[光线与色彩]\n暖黄色为主')


class ArtCreateRuns(unittest.TestCase):
    def run_create(self, outputs, requirement='一只橘猫趴在窗台上晒太阳'):
        assistant = service.PromptAssistant()
        calls = []
        assistant.generate = lambda prompt, **kwargs: calls.append((prompt, kwargs)) or outputs[len(calls) - 1]
        result = assistant.optimize_prompt({'surface': 'art', 'prompt': '', 'requirements': requirement})
        return calls, result

    def test_create_draws_anew_each_run_and_repairs_greedily(self):
        lying = QWEN3_INLINE_SECTIONS.replace('一个穿红色斗篷的少女站在雪山顶', '一只橘猫趴在窗台上')
        curled = lying.replace('趴在', '蜷缩在')
        calls, result = self.run_create([curled, lying])
        first, repair = calls[0][1], calls[1][1]
        self.assertTrue(first['do_sample'])
        self.assertGreater(first['temperature'], 0)
        self.assertFalse(repair['do_sample'])
        self.assertEqual(repair['trace_label'], 'artCreateRepair')
        self.assertIn('需求里的“趴”要按原词写进 [主体物品]', calls[1][0])
        self.assertIn('趴在窗台上', result['positivePrompt'])
        self.assertTrue(all(line.endswith('。') for line in result['positivePrompt'].split('\n') if line and not line.startswith('[')))
        # Two runs draw two seeds.
        seeds = {self.run_create([lying])[0][0][1]['seed'] for _ in range(3)}
        self.assertGreater(len(seeds), 1)

    def test_create_keeps_a_laid_out_answer_when_the_repair_breaks_the_layout(self):
        curled = QWEN3_INLINE_SECTIONS.replace('一个穿红色斗篷的少女站在雪山顶', '一只橘猫蜷缩在窗台上')
        calls, result = self.run_create([curled, '一只橘猫趴在窗台上。'])
        self.assertEqual(len(calls), 2)
        self.assertEqual(service.art_five_section_failure(result['positivePrompt']), '')
        self.assertIn('蜷缩在窗台上', result['positivePrompt'])
        # rawOutput is the model text the kept answer came from, not the repair and not the cleaned prompt.
        self.assertEqual(result['rawOutput'], curled)

    def test_create_raw_output_is_the_model_text_and_negations_go_from_every_section(self):
        written = QWEN3_INLINE_SECTIONS.replace('积雪覆盖的岩石', '脚下无地面无水面，积雪覆盖的岩石').replace(
            '一个穿红色斗篷的少女站在雪山顶', '一只橘猫趴在窗台上')
        _, result = self.run_create([written])
        self.assertEqual(result['rawOutput'], written)
        self.assertNotIn('无地面', result['positivePrompt'])
        self.assertIn('积雪覆盖的岩石', result['positivePrompt'])


if __name__ == '__main__':
    unittest.main()
