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
        # The renderer's own strings: role reference prefixes 用户生成要求, 单图反推 its carrier label.
        both = '用户提示词：橘猫坐在大厅的地毯上，抬头看向镜头\n用户补充要求：画面改为夜晚'
        requirements = '用户生成要求：' + both
        captured, _ = self.reverse(['subject', 'background'], requirements, QWEN3_INLINE_SECTIONS)
        prompt = captured['prompt']
        self.assertIn('用户要求（优先于图片内容，写进相关段落，不单独成段）：橘猫坐在大厅的地毯上，抬头看向镜头\n画面改为夜晚\n', prompt)
        self.assertIn('时间是夜晚', prompt)
        self.assertNotRegex(prompt, '用户生成要求|用户提示词|用户补充要求')
        self.assertEqual(len(captured['images']), 2)
        # 单图反推 keeps all of it as the final constraint, within the 2000 characters the worker sends.
        static = '用户补充要求（只作为最终提示词约束，不作为图片可见事实）：' + both
        self.assertTrue(service.append_rich_generation_requirements('[风格设定]\n写实', static).endswith(
            '[用户附加要求]\n要求 = "用户补充要求（只作为最终提示词约束，不作为图片可见事实）：用户提示词：橘猫坐在大厅的地毯上，抬头看向镜头 用户补充要求：画面改为夜晚"'))
        self.assertTrue(service.append_rich_generation_requirements('写实', 'x' * 2600).endswith('\n要求 = "' + 'x' * 2000 + '"'))

    def role_check(self, roles, requirements, *outputs):
        """The role reference with stubbed model answers, one per call (the last one repeats); self.calls keeps
        what was sent."""
        self.calls = []
        original = service.data_url_to_tensor
        service.data_url_to_tensor = lambda _url: object()
        assistant = service.PromptAssistant()
        assistant.generate = lambda prompt, **kwargs: self.calls.append(prompt) or outputs[min(len(self.calls), len(outputs)) - 1]
        try:
            return assistant.reverse_image_prompt({
                'purpose': 'roleReference', 'requirements': requirements,
                'images': [{'dataUrl': 'data:image/png;base64,AA==', 'role': role, 'slotType': role} for role in roles],
            })
        finally:
            service.data_url_to_tensor = original

    def test_role_reference_answers_the_check_line_in_its_one_call(self):
        # The H3 writer's line with 人物 added, its 未成年 rule as it is, and 敏感 grading the user's request too.
        for part in ('写成“人物=有或无；未成年=有或无；敏感=有或无”。图中有人或人形角色',
                     '图中有明确的未成年人文字或直接证据（如婴儿、幼童、儿童）才写未成年=有，看起来年轻不算；',
                     '图中有、或用户要求画出裸露、性暗示姿势或性行为才写敏感=有'):
            self.assertIn(part, service.ART_REFERENCE_CHECK)
        self.assertIn('图中有明确的未成年人文字或直接证据（如婴儿、幼童、儿童）才写未成年=有，看起来年轻不算', service.MINIMAX_H3_FRAME_CHECK)
        plain = self.role_check(['subject'], '', QWEN3_INLINE_SECTIONS)
        self.assertTrue(self.calls[0].endswith('只输出这五段和最后一行检查，不要前言、解释、Markdown 符号或负向提示词。\n'
                                               '五段之后另起一行：' + service.ART_REFERENCE_CHECK))
        self.assertEqual((plain['generationGate'], plain['sensitivePromptBlocked']), ('direct', False))
        self.assertEqual(plain['contentSafety'], {'sensitiveContent': False, 'explicitMinorEvidence': False})
        check = '人物=有；未成年=无；敏感=有'
        one_line = QWEN3_INLINE_SECTIONS.replace('\n\n', ' ')
        # Wherever and however the line is written, it is read and removed, with a note or a 负向 line after it,
        # before the five sections are checked: the prompt is the one the same answer gives without it.
        for roles in (['subject'], ['subject', 'style']):
            for written, base in ((QWEN3_INLINE_SECTIONS + '\n检查：' + check, QWEN3_INLINE_SECTIONS),
                                  (QWEN3_INLINE_SECTIONS + '。检查：' + check, QWEN3_INLINE_SECTIONS),
                                  ('检查：' + check + '\n' + QWEN3_INLINE_SECTIONS, QWEN3_INLINE_SECTIONS),
                                  (QWEN3_INLINE_SECTIONS + '\n\n[检查]\n人物：有；未成年：无；敏感：有', QWEN3_INLINE_SECTIONS),
                                  (QWEN3_INLINE_SECTIONS + '\n检查结果：' + check, QWEN3_INLINE_SECTIONS),
                                  (QWEN3_INLINE_SECTIONS + '\n**检查**：' + check, QWEN3_INLINE_SECTIONS),
                                  (QWEN3_INLINE_SECTIONS + '。敏感=有；人物=有；未成年=无', QWEN3_INLINE_SECTIONS),
                                  (QWEN3_INLINE_SECTIONS + '\n检查：' + check + '\n说明：图中为成年女性', QWEN3_INLINE_SECTIONS),
                                  (QWEN3_INLINE_SECTIONS + '。检查：' + check + '\n负向提示词：模糊', QWEN3_INLINE_SECTIONS),
                                  ('检查：' + check + ' ' + one_line, one_line)):
                with self.subTest(roles=roles, written=written):
                    result = self.role_check(roles, '', written)
                    calls = len(self.calls)
                    self.assertEqual(result['positivePrompt'], self.role_check(roles, '', base)['positivePrompt'])
                    self.assertEqual(calls, len(self.calls))
                    self.assertEqual(calls, 2 if base == one_line else 1)
                    self.assertNotRegex(result['positivePrompt'] + result['rawOutput'], '检查|未成年|敏感|人物[=＝:：]|说明|负向')
                    # A sensitive picture with a person asks for NSFW, as the static reverse's adult_confirmation;
                    # a young look (少女) alone is no minor evidence.
                    self.assertEqual(result['generationGate'], 'adult_confirmation')
                    self.assertFalse(result['sensitivePromptBlocked'])
                    self.assertEqual(result['contentSafety'], {'sensitiveContent': True, 'explicitMinorEvidence': False})
                    self.assertEqual(result['contentCheck'], {'person': True, 'minor': False, 'sensitive': True})
        # A benign picture goes as it is.
        night = '用户生成要求：画面改为夜晚'
        result = self.role_check(['subject'], night, QWEN3_INLINE_SECTIONS + '\n检查：人物=有；未成年=无；敏感=无')
        self.assertEqual((result['generationGate'], result['contentSafety']), ('direct', {'sensitiveContent': False, 'explicitMinorEvidence': False}))
        self.assertEqual(result['positivePrompt'], self.role_check(['subject'], night, QWEN3_INLINE_SECTIONS)['positivePrompt'])
        # The repair sees the last answer without its check line; what either call said counts.
        prose = '一只橘猫趴在窗台上晒太阳。\n检查：人物=有；未成年=无；敏感=有'
        result = self.role_check(['subject'], '', prose, QWEN3_INLINE_SECTIONS + '\n检查：未成年=无；敏感=无')
        self.assertEqual(len(self.calls), 2)
        self.assertIn('上次结果：\n一只橘猫趴在窗台上晒太阳。', self.calls[1])
        self.assertNotIn('检查：人物=有', self.calls[1])
        self.assertEqual(result['generationGate'], 'adult_confirmation')

    def test_role_reference_reports_the_signal_the_renderer_reads(self):
        adult = QWEN3_INLINE_SECTIONS.replace('少女', '成年女性')
        cases = [
            # (user text, check, sensitiveContent)
            ('', '人物=有；未成年=无；敏感=有', True),
            # No person: the static reverse gave no adult_confirmation, so no NSFW switch; an unanswered 人物 is 无.
            ('', '人物=无；未成年=无；敏感=有', False),
            ('', '未成年=无；敏感=有', False),
            # The check grades the user's request too (as Grok's contentSafety): the model decides, the words alone never
            # switch - a cover-up request (别裸露, 去掉裸露) is no request for nudity.
            ('用户生成要求：用户提示词：nude woman portrait，裸体', '人物=有；未成年=无；敏感=有', True),
            ('用户生成要求：用户提示词：nude woman portrait，裸体', '人物=有；未成年=无；敏感=无', False),
            ('用户生成要求：用户提示词：给她穿上外套，别裸露', '人物=有；未成年=无；敏感=无', False),
            ('用户生成要求：用户提示词：去掉裸露部分，穿上衣服', '人物=有；未成年=无；敏感=无', False),
            ('用户生成要求：用户提示词：背景换成裸露的红砖墙', '人物=有；未成年=无；敏感=无', False),
        ]
        for requirements, check, sensitive in cases:
            for roles in (['subject'], ['subject', 'background']):
                with self.subTest(requirements=requirements, check=check, roles=roles):
                    result = self.role_check(roles, requirements, adult + '\n检查：' + check)
                    self.assertEqual(result['contentSafety'], {'sensitiveContent': sensitive, 'explicitMinorEvidence': False})
                    self.assertEqual(result['generationGate'], 'adult_confirmation' if sensitive else 'direct')
                    self.assertFalse(result['sensitivePromptBlocked'])
                    self.assertNotRegex(result['positivePrompt'], '检查|未成年|敏感|人物[=＝:：]')

    def test_role_reference_blocks_explicit_minor_with_sensitive_content(self):
        child = QWEN3_INLINE_SECTIONS.replace('一个穿红色斗篷的少女', '一个穿红色斗篷的儿童')
        cases = [
            # (user text, answer, code, model calls)
            ('', QWEN3_INLINE_SECTIONS + '\n检查：人物=有；未成年=有；敏感=有', 'art-sensitive-young-evidence-blocked', 1),
            ('', child + '\n检查：人物=有；未成年=无；敏感=有', 'art-sensitive-young-evidence-blocked', 1),
            ('用户生成要求：explicit nude', QWEN3_INLINE_SECTIONS + '\n检查：人物=有；未成年=有；敏感=无', 'art-sensitive-young-evidence-blocked', 1),
            ('用户生成要求：用户提示词：画成裸体', QWEN3_INLINE_SECTIONS + '\n检查：人物=有；未成年=有；敏感=无', 'art-sensitive-young-evidence-blocked', 1),
            ('用户生成要求：用户提示词：一个儿童站在雪山顶', QWEN3_INLINE_SECTIONS + '\n检查：人物=有；未成年=无；敏感=有', 'art-sensitive-minor-request-blocked', 1),
            # The prompt's own words: the model wrote what the user asked for in words the user's text does not use.
            ('用户生成要求：用户提示词：脱光她的衣服', QWEN3_INLINE_SECTIONS.replace('一个穿红色斗篷的少女', '一个一丝不挂的小女孩')
             + '\n检查：人物=有；未成年=有；敏感=无', 'art-sensitive-young-evidence-blocked', 1),
            ('用户生成要求：用户提示词：脱光她的衣服', child.replace('穿红色斗篷的', '全裸的') + '\n检查：人物=有；未成年=无；敏感=无',
             'art-sensitive-young-evidence-blocked', 1),
            # The user's words alone never reach the model.
            ('用户生成要求：用户提示词：一个儿童站在雪山顶\n用户补充要求：explicit nude', QWEN3_INLINE_SECTIONS, 'art-sensitive-minor-request-blocked', 0),
        ]
        for requirements, answer, code, calls in cases:
            for roles in (['subject'], ['subject', 'background']):
                with self.subTest(requirements=requirements, answer=answer, roles=roles):
                    with self.assertRaises(service.VisualContractError) as raised:
                        self.role_check(roles, requirements, answer)
                    self.assertEqual(raised.exception.code, code)
                    self.assertEqual(raised.exception.diagnostics, {'errorCode': code, 'generationGate': 'blocked', 'sensitivePromptBlocked': True})
                    self.assertEqual(len(self.calls), calls)
        self.assertEqual(str(raised.exception), '提示词或补充要求包含明确未成年人内容，敏感提示词已阻止')

    def test_explicit_words_in_pieces_the_cleanup_drops_still_block(self):
        # The safety checks read the answer before the one-picture cleanup drops asides ("强调…", "突出…") and the
        # non-camera pieces of [拍摄参数].
        answer = ('[风格设定]\n日系动漫插画风格，线条细腻。\n\n[主体物品]\n一名人物站在海边，长发，面向镜头。\n\n'
                  '[环境背景]\n海边沙滩，远处海浪。\n\n[光线与色彩]\n午后阳光从右侧照来，主色为蓝白。\n\n[拍摄参数]\n{}\n'
                  '检查：人物=有；未成年=有；敏感=无')
        for camera in ('全身景别，正面视角，强调其一丝不挂的身体', '全身景别，正面视角，一丝不挂'):
            with self.subTest(camera=camera):
                with self.assertRaises(service.VisualContractError) as raised:
                    self.role_check(['subject'], '用户生成要求：让角色站在海边', answer.format(camera))
                self.assertEqual(raised.exception.code, 'art-sensitive-young-evidence-blocked')
        written = ('[风格设定]\n日系动漫插画风格，线条细腻。\n\n[主体物品]\n一名女子躺在床上，长发散开。\n\n'
                   '[环境背景]\n卧室，白色床单。\n\n[光线与色彩]\n窗外月光照在床上，主色为冷蓝。\n\n[拍摄参数]\n{}')
        draft = written.format('近景，俯视')
        # The fuse path drops an age that shares no words with the draft before its check, as it did before the cleanup.
        for camera in ('近景，俯视，突出床上12岁少女的身形', '近景，俯视，床上的12岁少女'):
            with self.subTest(camera=camera):
                assistant = service.PromptAssistant()
                assistant.generate = lambda prompt, camera=camera, **kwargs: written.format(camera)
                with self.assertRaisesRegex(ValueError, '提示词创作未通过内容检查'):
                    assistant.optimize_prompt({'surface': 'art', 'purpose': 'create', 'prompt': '', 'nsfw': True,
                                               'requirements': '用户创作需求：一名女子躺在床上'})
                assistant.generate = lambda prompt, camera=camera, **kwargs: written.replace('白色床单', '红色床单').format(camera)
                with self.assertRaisesRegex(ValueError, '提示词融合未通过内容检查'):
                    assistant.optimize_prompt({'surface': 'art', 'purpose': 'optimize', 'prompt': draft, 'currentPrompt': draft,
                                               'nsfw': True, 'requirements': '把床单改成红色'})

    def test_role_reference_child_in_a_harmless_scene_passes(self):
        # 未成年=有 with the user's everyday words that the static list matches (bare walls, the colour nude, a negated
        # word, a cover-up): the static reverse wrote these, and so does the role reference.
        answer = QWEN3_INLINE_SECTIONS.replace('一个穿红色斗篷的少女', '一个穿红色斗篷的小女孩') + '\n检查：人物=有；未成年=有；敏感=无'
        for text in ('背景换成裸露的红砖墙', '小女孩站在雪山顶，脚下是裸露的岩石', '小女孩穿 nude 色连衣裙', '小女孩衣着完整，不要裸露',
                     '小女孩挥动裸露的双臂', '给她穿上外套，别裸露', '去掉裸露部分，穿上衣服'):
            for roles in (['subject'], ['subject', 'background']):
                with self.subTest(text=text, roles=roles):
                    result = self.role_check(roles, '用户生成要求：用户提示词：' + text, answer)
                    self.assertEqual(result['generationGate'], 'direct')
                    self.assertEqual(result['contentSafety'], {'sensitiveContent': False, 'explicitMinorEvidence': True})
                    self.assertEqual(result['contentCheck'], {'person': True, 'minor': True, 'sensitive': False})
        # The answer's own everyday words: a negation the cleanup removes, bare rock, bare arms, legs and back.
        for written in ('衣着完整，没有裸露', '挥动裸露的双臂', '脚下是裸露的岩石', '裸露的双腿和后背'):
            with self.subTest(written=written):
                result = self.role_check(['subject'], '', answer.replace('斗篷在夜风中微扬', written))
                self.assertEqual((result['generationGate'], len(self.calls)), ('direct', 1))

    def test_role_reference_check_defaults_never_block_or_ask_for_nsfw(self):
        child = QWEN3_INLINE_SECTIONS.replace('一个穿红色斗篷的少女', '一个穿红色斗篷的儿童')
        for answer in (QWEN3_INLINE_SECTIONS,                                          # no line
                       QWEN3_INLINE_SECTIONS + '\n' + service.ART_REFERENCE_CHECK,     # the instruction copied back
                       QWEN3_INLINE_SECTIONS + '\n' + service.MINIMAX_H3_FRAME_CHECK,
                       QWEN3_INLINE_SECTIONS + '\n检查：人物=有或无；未成年=有或无；敏感=有或无',
                       QWEN3_INLINE_SECTIONS + '\n检查：看不清',
                       QWEN3_INLINE_SECTIONS + '\n检查：人物=有；未成年=有；敏感=无',  # a child, nothing sensitive
                       child + '\n检查：人物=有；未成年=有；敏感=无',
                       # The answer's own words are no sensitive request: bare rock is not a bare body.
                       child.replace('积雪覆盖的岩石', '裸露的岩石') + '\n检查：人物=有；未成年=有；敏感=无',
                       child):
            with self.subTest(answer=answer):
                result = self.role_check(['subject'], '用户生成要求：用户提示词：一个儿童站在雪山顶', answer)
                self.assertEqual(len(self.calls), 1)
                self.assertEqual(result['generationGate'], 'direct')
                self.assertFalse(result['sensitivePromptBlocked'])
                self.assertEqual(result['contentSafety'], {'sensitiveContent': False, 'explicitMinorEvidence': True})
                self.assertFalse(result['contentCheck']['sensitive'])
                self.assertNotRegex(result['positivePrompt'], '检查|未成年|敏感|人物[=＝:：]')
                self.assertEqual(service.art_five_section_failure(result['positivePrompt']), '')


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

class ArtRoleReferenceUserFitTest(unittest.TestCase):
    def test_the_users_change_holds_in_every_section(self):
        text = ('[风格设定]\n国潮插画风格，线条硬朗，上色采用高饱和度的红金配色，背景为纯白，整体氛围充满热血\n\n'
                '[主体物品]\n武将右手持一盏发光的灯笼，左手握剑\n\n[环境背景]\n纯白色背景\n\n'
                '[光线与色彩]\n夜晚，主光来自灯笼，月光或环境光作为辅助光源\n\n[拍摄参数]\n全身景别，正面视角')
        requirement = '让角色手持一盏发光的灯笼，夜晚'
        fit = service.art_role_reference_user_fit(text, requirement)
        # The style is the drawing only; an either/or keeps one; the hands the user never named lose their sides.
        self.assertIn('[风格设定]\n国潮插画风格，线条硬朗\n', fit)
        self.assertIn('武将一只手持一盏发光的灯笼，另一只手握剑', fit)
        self.assertIn('月光作为辅助光源', fit)
        # Night next to the picture's white backdrop, or a dropped action, is asked about once.
        self.assertIn('[环境背景] 还是图片原来的纯色背景', service.art_requirement_unfit(requirement, fit))
        self.assertEqual(service.art_requirement_unfit(requirement, fit.replace('纯白色背景', '夜色中的古城街道')), '')
        self.assertIn('漏写了用户写的“看向”：请在[主体物品]里写出“看向”', service.art_requirement_unfit('角色看向镜头', '[主体物品]\n武将站立'))
        # [拍摄参数]'s "正面视角" is the camera, not the subject looking; an action the user rules out is none.
        five = '[风格设定]\n国潮插画\n\n[主体物品]\n武将站在大厅中央\n\n[环境背景]\nT台秀场大厅\n\n[光线与色彩]\n顶光\n\n[拍摄参数]\n全身景别，正面视角，视线平视'
        self.assertIn('“看向”', service.art_requirement_unfit('图1的角色站在图2的场景中央，看向镜头', five))
        self.assertEqual(service.art_requirement_unfit('让角色不要拿剑，双手自然下垂', five), '')
        # The user's palette and a style name stay in [风格设定]; the user's choice of an either/or is kept.
        # A background there goes even in the user's own words: [环境背景] has the scene.
        self.assertIn('[风格设定]\n国潮插画风格，线条硬朗\n', service.art_role_reference_user_fit(text.replace('背景为纯白', '背景为雪夜古城街道的冷色调灯光'), '把背景换成雪夜古城街道，冷色调灯光'))
        for style in ['赛博朋克风格，霓虹配色', '厚涂光影的油画风格，笔触厚重']:
            self.assertIn('[风格设定]\n' + style + '\n', service.art_role_reference_user_fit(text.replace('国潮插画风格，线条硬朗，上色采用高饱和度的红金配色，背景为纯白，整体氛围充满热血', style), '改成赛博朋克风格，霓虹配色'))
        lit = service.art_role_reference_user_fit(text.replace('月光或环境光作为辅助光源', '月光或灯笼的光照亮人物'), requirement)
        self.assertIn('灯笼的光照亮人物', lit)
        self.assertNotIn('月光的光', lit)
        # A sword the answer lets go of for the new lantern is held again; one background colour and one mood.
        swapped = text.replace('武将右手持一盏发光的灯笼，左手握剑', '武将右手持一盏发光的灯笼，左手前伸似欲挥剑').replace(
            '纯白色背景', '纯黑夜空背景，整体氛围静谧而神秘').replace('夜晚，主光来自灯笼', '夜晚，主光来自灯笼，背景为深蓝与墨黑，营造出威严')
        fit = service.art_role_reference_user_fit(swapped, requirement)
        self.assertIn('武将一只手持一盏发光的灯笼，另一只手仍握着剑', fit)
        self.assertIn('[环境背景]\n纯黑夜空背景\n', fit)
        self.assertNotIn('深蓝与墨黑', fit)
        request = service.art_role_reference_request(['subject'], requirement)
        self.assertIn('只写画法，背景、光线、颜色和氛围写在后面几段', request)
        self.assertIn('时间是夜晚，环境也是夜晚的样子', request)
        self.assertIn('视角照图中主体的朝向写', request)
        self.assertIn('新拿的东西拿在图中空着的手里', request)
        self.assertIn('身边飘着或环绕的物件和特效', request)
        self.assertIn('图中主体手里原来拿着的道具照样写出、继续拿着，用户要求新拿的东西拿在另一只手里', request)
        self.assertNotIn('原来拿着的道具照样写出', service.art_role_reference_request(['subject'], '夜晚'))

    def test_the_reverse_fits_the_answer_and_asks_about_a_dropped_action_once(self):
        answer = ('[风格设定]\n国潮插画风格，背景为纯白\n\n[主体物品]\n武将右手持一盏发光的灯笼，左手前伸似欲挥剑\n\n[环境背景]\n夜色中的古城街道\n\n'
                  '[光线与色彩]\n夜晚，主光来自灯笼\n\n[拍摄参数]\n全身景别，正面视角\n检查：人物=有；未成年=无；敏感=无')
        for requirement, answers, calls_made in [('让角色手持一盏发光的灯笼，夜晚', [answer], 1),
                                                 ('让角色手持一盏发光的灯笼，夜晚，看向镜头', [answer, answer.replace('全身景别', '武将看向镜头，全身景别').replace(
                                                     '左手前伸似欲挥剑', '左手握剑，看向镜头')], 2)]:
            with self.subTest(requirement=requirement):
                assistant, prompts, replies = service.PromptAssistant(), [], iter(answers)
                assistant.generate = lambda prompt, **kwargs: prompts.append(prompt) or next(replies)
                result = assistant.reverse_art_role_prompt([{'tensor': 'image', 'role': 'subject'}], '用户补充要求：' + requirement, 'roleReference')
                self.assertEqual(len(prompts), calls_made)
                self.assertNotRegex(result['prompt'], '[左右]手|背景为纯白')
                self.assertIn('一只手持一盏发光的灯笼，另一只手', result['prompt'])
                if calls_made == 2:
                    self.assertIn('漏写了用户写的“看向”', prompts[1])
                    self.assertIn('看向镜头', result['prompt'])
                else:
                    self.assertIn('另一只手仍握着剑', result['prompt'])


class ArtOnePictureTest(unittest.TestCase):
    """The five sections describe one picture: the request says how they connect, and the cleanup takes out
    what contradicts itself. A plain draft with no edit is written out as a whole picture around the user's words."""

    def test_role_reference_request_ties_the_sections_together(self):
        request = service.art_role_reference_request(['subject', 'background'], '图1的角色站在图2的场景中央，看向镜头')
        # A posture the user writes replaces the picture's action.
        self.assertIn('图中原来的动作不再写，姿态按用户要的“站”写', request)
        # Every action the user writes is named for [主体物品], without the picture labels.
        self.assertIn('用户写的动作“角色站在场景中央、看向镜头”在这一段照原话写出', request)
        # The scene is read as its picture shows it, in its own style; the subject's props keep their own look.
        self.assertIn('照图写出看得见的建筑结构和陈设，样式、材质和颜色与图中一致；环境的风格和年代只按这张图写，看不准就只写结构和材质', request)
        self.assertIn('照图写出它们本来的颜色、纹样和附着物', request)
        # The light comes from the scene and falls on the subject; the palette merges both; the camera fits the scene.
        self.assertIn('光源是 [环境背景] 里有的东西，写它从哪边照到主体身上', request)
        self.assertIn('主色取画面里面积最大的颜色（通常是环境），主体的颜色作辅色或点缀', request)
        self.assertIn('环境写得清楚就不写背景虚化', request)
        self.assertIn('[拍摄参数] 只写镜头', request)
        self.assertIn('不写“突出……”“强调……”这类说明效果的话', request)
        # A pose picture decides the pose; with no posture word the picture's own action stays.
        posed = service.art_role_reference_request(['subject', 'pose'], '图1的角色站在中央')
        self.assertIn('姿势按图2', posed)
        self.assertNotIn('用户要的姿态', posed)
        lantern = service.art_role_reference_request(['subject'], '让角色手持一盏发光的灯笼，夜晚')
        self.assertIn('照图写姿态动作', lantern)
        self.assertNotIn('用户写的动作', lantern)
        # Night on a plain backdrop gets a place to be in, not an empty black sky.
        self.assertIn('给主体安排一处与他的身份和用户要求相配的夜晚场所', lantern)
        # A new scene is built out; its light comes from it and nothing in front hides the subject.
        scene = service.art_role_reference_request(['subject'], '把背景换成海边沙滩')
        self.assertIn('光线来自新环境里的光源', scene)
        self.assertIn('前景只放地面、台阶这类低处的东西，不挡住主体', scene)
        # The light the user asks for is quoted into the light duty, next to a night too.
        cold = service.art_role_reference_request(['subject'], '把背景换成雪夜古城街道，冷色调灯光')
        self.assertIn('用户要求的“冷色调灯光”照原意写进这一段', cold)
        self.assertNotIn('用户要求的“', lantern)

    def test_contradictions_and_asides_go_and_the_users_words_stay(self):
        text = (
            '[风格设定]\n国潮插画风格，线条硬朗有力，突出主体的视觉冲击力\n\n'
            '[主体物品]\n武将站在长廊中央，颧骨突出，脚边是突出的岩石\n\n'
            '[环境背景]\n雪夜古城街道，近处石板路与积雪清晰可见，背景虚化处理\n\n'
            '[光线与色彩]\n主光来自灯笼，光线柔和但对比强烈，整体偏冷\n\n'
            '[拍摄参数]\n全身景别，正面视角，构图居中突出人物，背景虚化处理，强调主体动态'
        )
        self.assertEqual(service.art_consistent_sections(text), (
            '[风格设定]\n国潮插画风格，线条硬朗有力\n\n'
            '[主体物品]\n武将站在长廊中央，颧骨突出，脚边是突出的岩石\n\n'
            '[环境背景]\n雪夜古城街道，近处石板路与积雪清晰可见\n\n'
            '[光线与色彩]\n主光来自灯笼，光线柔和，整体偏冷\n\n'
            '[拍摄参数]\n全身景别，正面视角，构图居中'
        ))
        # A blurred background is a camera choice when the scene is not called sharp; the user's own words stay.
        soft = service.art_consistent_sections(text.replace('近处石板路与积雪清晰可见，', ''))
        self.assertIn('背景虚化处理', soft.split('[拍摄参数]')[1])
        self.assertNotIn('背景虚化', soft.split('[环境背景]')[1].split('[光线与色彩]')[0])
        self.assertIn('强调主体动态', service.art_consistent_sections(text, '强调主体动态'))
        # [拍摄参数] keeps to the camera; robes do not blow in a hall with nothing to blow them.
        hall = (
            '[主体物品]\n武将站在长廊中央，红色战袍在气流中自然飘扬，发丝在风中剧烈翻飞\n\n'
            '[环境背景]\n现代大厅，米白色地毯的长廊\n\n'
            '[光线与色彩]\n暖色射灯从上方照下，营造出热血与威严交织的视觉张力\n\n'
            '[拍摄参数]\n全身景别，正面视角，背景结构清晰可见，衣摆与发丝自然垂落，环境细节丰富'
        )
        self.assertEqual(service.art_consistent_sections(hall), (
            '[主体物品]\n武将站在长廊中央，红色战袍自然垂落，发丝自然垂落\n\n'
            '[环境背景]\n现代大厅，米白色地毯的长廊\n\n'
            '[光线与色彩]\n暖色射灯从上方照下\n\n'
            '[拍摄参数]\n全身景别，正面视角，背景结构清晰可见'
        ))
        outdoor = hall.replace('现代大厅，米白色地毯的长廊', '雪夜古城街道，青石板路')
        self.assertIn('在气流中自然飘扬', service.art_consistent_sections(outdoor))
        self.assertIn('在气流中自然飘扬', service.art_consistent_sections(hall.replace('现代大厅', '现代大厅，风扇吹动')))
        # The style section holds the drawing: a colour claim there ("鲜艳饱和") fights the night the user asked for.
        style = '[风格设定]\n国潮插画风格，线条遒劲有力，上色采用鲜艳饱和的矿物颜料\n\n[主体物品]\n武将'
        self.assertIn('[风格设定]\n国潮插画风格，线条遒劲有力\n', service.art_role_reference_user_fit(style, '让角色手持一盏发光的灯笼，夜晚'))
        # The user's own light words belong to [光线与色彩], not to the drawing.
        lit = style.replace('上色采用鲜艳饱和的矿物颜料', '冷色调灯光营造出肃杀氛围')
        self.assertIn('[风格设定]\n国潮插画风格，线条遒劲有力\n', service.art_role_reference_user_fit(lit, '把背景换成雪夜古城街道，冷色调灯光'))
        # ... and are written in [光线与色彩] when the answer has them nowhere else.
        moved = service.art_role_reference_user_fit(lit + '\n\n[光线与色彩]\n夜晚灯笼暖黄光从两侧照在人物身上', '把背景换成雪夜古城街道，冷色调灯光')
        self.assertIn('[光线与色彩]\n夜晚灯笼暖黄光从两侧照在人物身上，冷色调灯光。', moved)
        said = service.art_role_reference_user_fit(lit + '\n\n[光线与色彩]\n冷色调的灯光从两侧照下', '把背景换成雪夜古城街道，冷色调灯光')
        self.assertEqual(said.count('冷色调'), 1)

    def test_an_action_the_repair_still_leaves_out_is_written_in_the_users_words(self):
        answer = ('[风格设定]\n国潮插画风格\n\n[主体物品]\n武将站立于大堂中央，剑尖斜指下方\n\n[环境背景]\n现代大堂，米白色地毯\n\n'
                  '[光线与色彩]\n顶部暖色灯带照下\n\n[拍摄参数]\n全身景别，正面视角\n检查：人物=有；未成年=无；敏感=无')
        assistant, prompts = service.PromptAssistant(), []
        assistant.generate = lambda prompt, **kwargs: prompts.append(prompt) or answer
        result = assistant.reverse_art_role_prompt([{'tensor': 'a', 'role': 'subject'}, {'tensor': 'b', 'role': 'background'}],
                                                   '用户生成要求：图1的角色站在图2的场景中央，看向镜头', 'roleReference')
        self.assertEqual(len(prompts), 2)
        self.assertIn('漏写了用户写的“看向”', prompts[1])
        self.assertIn('[主体物品]\n武将站立于大堂中央，剑尖斜指下方，看向镜头。', result['prompt'])
        self.assertNotIn('图2', result['prompt'])

    def test_a_near_form_of_the_users_look_is_written_in_the_users_words_without_a_repair(self):
        answer = ('[风格设定]\n国潮插画风格\n\n[主体物品]\n武将站立于大堂中央，面向镜头，剑尖斜指下方\n\n'
                  '[环境背景]\n现代大堂，米白色地毯，主体位于地毯正中，正对镜头\n\n'
                  '[光线与色彩]\n顶部暖色灯带照下\n\n[拍摄参数]\n全身景别，正面视角\n检查：人物=有；未成年=无；敏感=无')
        assistant, prompts = service.PromptAssistant(), []
        assistant.generate = lambda prompt, **kwargs: prompts.append(prompt) or answer
        result = assistant.reverse_art_role_prompt([{'tensor': 'a', 'role': 'subject'}, {'tensor': 'b', 'role': 'background'}],
                                                   '用户生成要求：图1的角色站在图2的场景中央，看向镜头', 'roleReference')
        # One call; the look is said once, where the model put it, and the subject is placed once.
        self.assertEqual(len(prompts), 1)
        self.assertIn('[主体物品]\n武将站立于大堂中央，看向镜头，剑尖斜指下方。', result['prompt'])
        self.assertIn('[环境背景]\n现代大堂，米白色地毯。', result['prompt'])
        # A look the answer already writes in its own verb stays as it is.
        gaze = '[主体物品]\n少女眺望远方，面朝远方的山\n\n[拍摄参数]\n全景'
        self.assertEqual(service.art_user_look_words(gaze, '让少女望向远方'), gaze)
        self.assertIn('少女望向远方', service.art_user_look_words('[主体物品]\n少女面朝远方\n\n[拍摄参数]\n全景', '让少女望向远方'))

    def test_a_new_place_in_a_posture_is_a_new_scene_and_the_subject_is_described_first(self):
        request = service.art_role_reference_request(['subject'], '让机器人坐在雨夜的城市天台边缘，霓虹灯光')
        # The place is a new scene: built out, lit by the user's light next to the subject, at night, in the rain.
        self.assertIn('按用户要求写新环境（让机器人坐在雨夜的城市天台边缘，霓虹灯光）', request)
        self.assertIn('发出“霓虹灯光”的灯具写在主体身边、照得到主体的位置', request)
        self.assertIn('时间是雨夜', request)
        self.assertIn('用户要的天气也落在主体身上', request)
        # The action is the user's words without 让, the time or the weather, written after the subject's look.
        self.assertIn('用户写的动作“机器人坐在城市天台边缘”在这一段照原话写出，写在外观之后', request)
        self.assertLess(request.index('外观、神情'), request.index('用户写的动作'))
        # The user places the subject, so [环境背景] only builds the place.
        self.assertNotIn('主体站在其中的什么位置', request)
        # A chair is no new scene; a new street with no placement asks where the subject stands.
        self.assertNotIn('按用户要求写新环境', service.art_role_reference_request(['subject'], '让角色坐在椅子上'))
        street = service.art_role_reference_request(['subject'], '把背景换成雪夜古城街道，冷色调灯光')
        self.assertIn('以及主体站在其中的什么位置、脚下是什么', street)
        self.assertIn('发出“冷色调灯光”的灯具写在主体身边', street)
        self.assertIn('用户要的天气也落在主体身上', street)
        # A background picture is read for its venue and its lights; a subject the user placed is placed once.
        hall = service.art_role_reference_request(['subject', 'background'], '图1的角色站在图2的场景中央，看向镜头')
        self.assertIn('从座位排布、通道和台面看出这是什么场地，并照图写出看得见的灯具', hall)
        self.assertNotIn('以及主体站或坐在这个环境的什么位置', hall)
        self.assertIn('以及主体站或坐在这个环境的什么位置', service.art_role_reference_request(['subject', 'background'], '图1的角色放进图2'))
        self.assertIn('每段写两句通顺的完整句子', hall)
        self.assertIn('主体是谁、长什么样写在 [主体物品]', street)

    def test_the_cleanup_keeps_descriptions_and_holds_one_picture(self):
        # 突出 that describes the picture stays; the aside and a "visual focus" go, the colours stay.
        text = ('[风格设定]\n水彩插画风格\n\n[主体物品]\n一块礁石突出海面，少年眉骨突出明显\n\n[环境背景]\n海边礁石\n\n'
                '[光线与色彩]\n夕阳从左侧照来，辅以主体的红金配色作为视觉焦点\n\n[拍摄参数]\n中景，背景虚化突出人物')
        self.assertEqual(service.art_consistent_sections(text), text.replace('作为视觉焦点', '').replace('突出人物', ''))
        # The subject is placed once; the light on things is [光线与色彩]'s; a hazy distance is not called sharp.
        scene = ('[主体物品]\n武将站立于大堂中央，看向镜头\n\n'
                 '[环境背景]\n米白色地毯铺满通道，远处楼层朦胧，主体位于地毯正中，正对镜头，射灯在武将肩头形成高光\n\n'
                 '[光线与色彩]\n射灯从两侧照下\n\n[拍摄参数]\n全身景别，武将占据画面核心，背景的楼层清晰呈现，景深清晰')
        self.assertEqual(service.art_consistent_sections(scene), (
            '[主体物品]\n武将站立于大堂中央，看向镜头\n\n[环境背景]\n米白色地毯铺满通道，远处楼层朦胧\n\n'
            '[光线与色彩]\n射灯从两侧照下\n\n[拍摄参数]\n全身景别，武将占据画面核心'))
        self.assertIn('主体位于地毯正中，正对镜头', service.art_consistent_sections(scene.replace('武将站立于大堂中央，', '武将')))
        # A blurred camera keeps a sharp subject in focus but not a sharp background.
        blur = service.art_consistent_sections(scene.replace('远处楼层朦胧', '远处楼层').replace('景深清晰', '背景虚化，面部清晰对焦'))
        self.assertIn('[拍摄参数]\n全身景别，武将占据画面核心，背景虚化，面部清晰对焦', blur)
        # An open courtyard is outdoors.
        court = '[主体物品]\n少女的裙摆随风飘扬\n\n[环境背景]\n庭院中的长廊，青石地面\n\n[拍摄参数]\n全景'
        self.assertIn('随风飘扬', service.art_consistent_sections(court))
        self.assertIn('自然垂落', service.art_consistent_sections(court.replace('庭院中的', '')))
        # One time of day: the user's, else the light section's, else the first; an edit leaves it to its own checks.
        times = ('[风格设定]\n水彩插画风格，营造温暖宁静的午后氛围，画面质感如晨光轻拂纸面\n\n[主体物品]\n橘猫趴在窗台上\n\n'
                 '[环境背景]\n木质窗台\n\n[光线与色彩]\n阳光从右侧斜射入窗\n\n[拍摄参数]\n中景')
        self.assertEqual(service.art_consistent_sections(times), times.replace('，画面质感如晨光轻拂纸面', ''))
        self.assertNotIn('午后', service.art_consistent_sections(times, '清晨的橘猫'))
        lit = times.replace('阳光从右侧斜射入窗', '清晨阳光从右侧斜射入窗')
        self.assertNotIn('午后', service.art_consistent_sections(lit))
        self.assertIn('晨光', service.art_consistent_sections(lit))
        self.assertEqual(service.art_consistent_sections(times, one_time=False), times)
        fire = '[主体物品]\n武将站在大殿中央，周身火焰随风舞动，香炉青烟随风飘动，手中旗帜迎风飘扬\n\n[环境背景]\n宫殿大厅，红柱金瓦'
        self.assertIn('周身火焰舞动，香炉青烟飘动，手中旗帜自然垂落', service.art_consistent_sections(fire))
        camera = '[环境背景]\n远处是山影与飞檐，青石长街\n\n[拍摄参数]\n全身景别，正面视角，背景的山影与飞檐在画面中后景呈现，武将占据画面中央'
        self.assertIn('[拍摄参数]\n全身景别，正面视角，武将占据画面中央', service.art_consistent_sections(camera))
        for avoid in ('避免：过曝，画面模糊，多余肢体', '避免：背景虚化, 构图杂乱', '避免：黄昏色调'):
            with self.subTest(avoid=avoid):
                kept = '[环境背景]\n古城街道，远处屋檐清晰可见\n\n[光线与色彩]\n清晨阳光\n\n[拍摄参数]\n全身景别，正面视角。\n' + avoid
                self.assertEqual(service.art_consistent_sections(kept), kept)
        # Light on things leaves the scene; a scene's own highlight ("降低纯白高光") stays.
        hall = '[环境背景]\n象牙白宫廷，降低纯白高光并恢复层次，灯笼在石阶上留下高光'
        self.assertEqual(service.art_consistent_sections(hall), '[环境背景]\n象牙白宫廷，降低纯白高光并恢复层次')

    def test_an_edit_keeps_its_own_words(self):
        draft = ('[风格设定]\n国潮插画风格，线条硬朗。\n\n[主体物品]\n红袍武将站在长街中央，手握长剑，红色披风垂在身后。\n\n'
                 '[环境背景]\n雪夜古城街道，两侧木楼挂着灯笼，远处城楼轮廓清晰可见。\n\n'
                 '[光线与色彩]\n灯笼暖光从两侧照亮人物，整体冷蓝为主。\n\n[拍摄参数]\n全身景别，正面平视，构图居中。')
        edits = (
            ('背景虚化', draft.replace('构图居中。', '构图居中，背景虚化。'), '构图居中，背景虚化。'),
            ('强调人物轮廓光', draft.replace('从两侧照亮人物，', '从两侧照亮人物，强调人物轮廓光，'), '强调人物轮廓光'),
            ('把背景换成宫殿大厅，披风随风飘扬', draft.replace('雪夜古城街道，两侧木楼挂着灯笼，远处城楼轮廓清晰可见。', '宫殿大厅，红柱金瓦，殿门敞开。')
             .replace('红色披风垂在身后。', '红色披风随风飘扬。'), '红色披风随风飘扬'),
        )
        for instruction, answer, kept in edits:
            with self.subTest(instruction=instruction):
                assistant, calls = service.PromptAssistant(), []
                assistant.generate = lambda prompt, answer=answer, **kwargs: calls.append(prompt) or answer
                result = assistant.optimize_prompt({'surface': 'art', 'purpose': 'optimize', 'prompt': draft, 'currentPrompt': draft,
                                                    'requirements': instruction})
                self.assertEqual(len(calls), 1)
                self.assertIn(kept, result['positivePrompt'])

    def test_posture_words_are_the_subjects_own(self):
        for requirement in ('把背景换成地铁站', '把背景换成坐落在湖边的古镇', '背景换成骑楼街道', '让角色靠近镜头',
                            '加上漂浮的花瓣环绕角色', '身边加一只盘旋的凤凰', '角色身边漂浮着花瓣'):
            with self.subTest(requirement=requirement):
                self.assertEqual(service.art_user_state_words(requirement), [])
                self.assertIn('照图写姿态动作', service.art_role_reference_request(['subject'], requirement))
        for requirement, words in (('让角色站在一只坐着的狗旁边', ['站']), ('让角色骑马', ['骑']), ('让角色靠在墙上', ['靠']),
                                   ('猫咪漂浮在太空中', ['漂浮']), ('一只橘猫趴在窗台上晒太阳', ['趴']), ('角色站立，双手叉腰', ['站'])):
            with self.subTest(requirement=requirement):
                self.assertEqual(service.art_user_state_words(requirement), words)
        # A place is no posture to repair in an enriched draft.
        town = ('[风格设定]\n水彩插画风格，笔触柔润。\n\n[主体物品]\n{}\n\n[环境背景]\n{}\n\n'
                '[光线与色彩]\n夕阳从西侧斜照，暖橙为主，辅以灰蓝。\n\n[拍摄参数]\n远景，平视，三分构图。')
        for prompt, subject, scene in (('靠海的小镇，黄昏', '一座海边小镇，白墙红瓦的房屋沿坡排列。', '海港与石砌码头，远处灯塔。'),
                                       ('未来空间站内部', '一座未来太空舱内部，环形走廊与控制台。', '舱壁金属面板，舷窗外是地球。')):
            with self.subTest(prompt=prompt):
                calls, _ = self.enrich(town.format(subject, scene), prompt=prompt)
                self.assertEqual(len(calls), 1)

    def test_a_missing_action_is_written_as_the_subjects_action(self):
        text = ('[风格设定]\n国潮插画风格。\n\n[主体物品]\n红袍武将站立，手握长剑，面向前方。\n\n[环境背景]\n古城街道。\n\n'
                '[光线与色彩]\n暖光。\n\n[拍摄参数]\n全身景别，正面视角。')
        for requirement, written in (('让角色举起右手', '举起右手'), ('把主体图中的角色改成挥手打招呼', '挥手打招呼'),
                                     ('第一张图的人物看向镜头', '看向镜头'), ('请让他转身回头看', '转身回头看')):
            with self.subTest(requirement=requirement):
                self.assertIn('[主体物品]\n红袍武将站立，手握长剑，面向前方，' + written + '。',
                              service.art_write_missing_actions(text, requirement))

    def test_an_enriched_draft_guesses_no_age_and_keeps_the_users_avoidance(self):
        answer = ('[风格设定]\n日系动漫插画风格，线条细腻。\n\n[主体物品]\n{}\n\n[环境背景]\n海边礁石，远处海平线。\n\n'
                  '[光线与色彩]\n夕阳从正前方照来，暖橙为主。\n\n[拍摄参数]\n中景，平视，构图居中。')
        for subject in ('一个女孩坐在海边的礁石上看日落，约十二岁，黑色短发。', '一个看起来十几岁的女孩坐在海边的礁石上看日落，黑色短发。',
                        '一个年约十来岁的女孩坐在海边的礁石上看日落，黑色短发。', '一个二十出头的女孩坐在海边的礁石上看日落，黑色短发。'):
            with self.subTest(subject=subject):
                calls, result = self.enrich(answer.format(subject), prompt='一个女孩坐在海边的礁石上看日落')
                self.assertIn('[主体物品]\n一个女孩坐在海边的礁石上看日落，黑色短发。', result['positivePrompt'])
        self.assertIn('年龄', calls[0][0])
        # The user's own age stays.
        _, result = self.enrich(answer.format('一个十六岁的女孩坐在海边的礁石上看日落，黑色短发。'), prompt='一个十六岁的女孩坐在海边的礁石上看日落')
        self.assertIn('一个十六岁的女孩', result['positivePrompt'])
        # The user's avoidance line stays in one call; the request adds no negatives of its own but keeps the user's.
        calls, result = self.enrich(self.WRITTEN, prompt='一只橘猫趴在窗台上晒太阳，水彩风格。\n避免：文字、水印、多余的猫。')
        self.assertEqual(len(calls), 1)
        self.assertIn('\n避免：文字、水印、多余的猫。', result['positivePrompt'])
        self.assertIn('也不添加用户没写的否定说法', calls[0][0])

    def test_the_role_reference_keeps_the_pictures_look_and_the_users_pose(self):
        text = ('[风格设定]\n国潮插画风格，线条刚劲有力，上色采用鲜明的红金对比\n\n'
                '[主体物品]\n武将一只手持一柄通体银光、剑鞘为金色的长剑，剑身泛着寒光，剑柄为金色狮首，另一只手抬起呈防御姿态，站立于大堂中央\n\n'
                '[环境背景]\n秀场通道\n\n[光线与色彩]\n射灯照下\n\n[拍摄参数]\n全身景别')
        # No colours in the drawing; stock sheen and the picture's fight under the user's posture go.
        fit = service.art_role_reference_user_fit(text, '图1的角色站在图2的场景中央，看向镜头', ['subject', 'background'])
        self.assertIn('[风格设定]\n国潮插画风格，线条刚劲有力\n', fit)
        self.assertIn('[主体物品]\n武将一只手持一柄剑鞘为金色的长剑，剑柄为金色狮首，站立于大堂中央\n', fit)
        self.assertNotIn('铜色', service.art_role_reference_user_fit(text.replace('上色采用鲜明的红金对比', '上色为青绿色与铜色混合'), '夜晚'))
        # A pose picture decides the pose; the user's own sheen stays; no posture asked for keeps the picture's stance.
        self.assertIn('另一只手抬起呈防御姿态', service.art_role_reference_user_fit(text, '图1的角色站在中央', ['subject', 'pose']))
        self.assertIn('一只手紧握一柄长剑', service.art_role_reference_user_fit(
            text.replace('一只手持一柄通体银光、剑鞘为金色的长剑', '一只手紧握一柄寒光闪烁的长剑'), '让角色手持一盏发光的灯笼，夜晚'))
        self.assertIn('剑身泛着寒光', service.art_role_reference_user_fit(text, '剑身泛着寒光'))
        self.assertIn('另一只手抬起呈防御姿态', service.art_role_reference_user_fit(text, '让角色手持一盏发光的灯笼，夜晚'))

    def test_enriching_keeps_fitting_weather_and_drops_it_under_the_users_sun(self):
        raw = ('[风格设定]\n油画风格\n\n[主体物品]\n穿红色斗篷的女孩站在雪山顶上眺望远方\n\n'
               '[环境背景]\n雪山之巅，远处是连绵雪峰与薄雾，山间飘着细碎的雪花\n\n[光线与色彩]\n冷光\n\n[拍摄参数]\n中景，景深拉长至远景雪峰')
        kept = service.art_drop_invented_clauses(raw, '穿红色斗篷的女孩站在雪山顶上眺望远方', '', enrich=True)
        self.assertIn('远处是连绵雪峰与薄雾，山间飘着细碎的雪花', kept)
        sunny = service.art_drop_invented_clauses(raw, '穿红色斗篷的女孩在雪山顶上晒太阳', '', enrich=True)
        self.assertNotIn('薄雾', sunny)
        self.assertNotIn('雪花', sunny)
        # An edit still keeps to the edit: weather nobody asked for goes.
        self.assertNotIn('薄雾', service.art_drop_invented_clauses(raw, '穿红色斗篷的女孩站在雪山顶上眺望远方', '把斗篷改成蓝色'))

    WRITTEN = (
        '[风格设定]\n温暖的水彩绘本插画，笔触柔润。\n\n'
        '[主体物品]\n一只圆润的橘猫趴在窗台上晒太阳，眯着眼睛，尾巴卷在身侧，年龄约三岁。\n\n'
        '[环境背景]\n木质窗台上摆着一盆绿萝，窗外是午后的小院，远处有细雨，背景虚化。\n\n'
        '[光线与色彩]\n午后阳光从窗外斜照进来，在猫背上落下暖黄的光斑，主色为橘黄与奶白。\n\n'
        '[拍摄参数]\n中景平视，猫位于画面中央，浅景深，突出猫咪的慵懒。'
    )

    def enrich(self, *outputs, prompt='一只橘猫趴在窗台上晒太阳'):
        assistant = service.PromptAssistant()
        calls = []
        assistant.generate = lambda request, **kwargs: calls.append((request, kwargs)) or outputs[min(len(calls), len(outputs)) - 1]
        result = assistant.optimize_prompt({
            'surface': 'art', 'purpose': 'optimize', 'prompt': prompt, 'currentPrompt': prompt,
            'requirements': '提示词编辑模式：以 prompt / currentPrompt 中的完整原提示词为语义底稿。\n基础质量由系统自动负责：人物增强面部。',
        })
        return calls, result

    def test_a_plain_draft_with_no_edit_becomes_a_whole_picture(self):
        calls, result = self.enrich(self.WRITTEN)
        self.assertEqual(len(calls), 1)
        request, kwargs = calls[0]
        self.assertIn('用户写的画面：\n一只橘猫趴在窗台上晒太阳', request)
        self.assertIn(service.ART_ENRICH_INSTRUCTION, request)
        self.assertIn(service.ART_ENRICH_SYSTEM_TEXT, kwargs['llama_template'])
        self.assertNotIn('基础质量由系统自动负责', request)
        text = result['positivePrompt']
        # The style and the time of day chosen to fit stay; invented rain, a guessed age and asides go.
        self.assertIn('[风格设定]\n温暖的水彩绘本插画', text)
        self.assertIn('午后阳光从窗外斜照进来', text)
        for gone in ('细雨', '三岁', '突出', '背景虚化'):
            self.assertNotIn(gone, text)
        self.assertIn('浅景深', text)
        self.assertEqual(service.art_five_section_failure(text), '')
        self.assertEqual(result['editContract'], 'nf.art.semantic-fusion.v1')
        # An edit keeps to the edit: the same answer loses the style and the time nobody asked for.
        edit = service.art_drop_invented_clauses(self.WRITTEN, '一只橘猫趴在窗台上晒太阳', '把窗台改成木质')
        self.assertNotIn('水彩', edit)
        self.assertNotIn('午后', edit)
        # A draft that already has sections is enriched under the edit rules.
        sectioned = service.normalize_art_sections(QWEN3_INLINE_SECTIONS)
        calls, _ = self.enrich(sectioned.replace('远处连绵雪峰', '远处连绵雪峰，雪面反射冷蓝月光'), prompt=sectioned)
        self.assertIn(service.ART_SEMANTIC_FUSION_RULES, calls[0][1]['llama_template'])

    def test_an_enriched_draft_keeps_the_users_posture(self):
        curled = self.WRITTEN.replace('趴在', '蜷缩在')
        calls, result = self.enrich(curled, self.WRITTEN)
        self.assertEqual(len(calls), 2)
        self.assertIn('需求里的“趴”要按原词写进 [主体物品]', calls[1][0])
        self.assertIn('趴在窗台上', result['positivePrompt'])
        # A repair that comes back as one bare line leaves the first answer as the result.
        calls, result = self.enrich(curled, '一只橘猫趴在窗台上。')
        self.assertEqual(len(calls), 2)
        self.assertIn('蜷缩在窗台上', result['positivePrompt'])
        self.assertEqual(service.art_five_section_failure(result['positivePrompt']), '')


if __name__ == '__main__':
    unittest.main()
