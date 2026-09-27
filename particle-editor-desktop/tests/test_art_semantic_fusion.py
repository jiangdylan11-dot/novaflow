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
        self.assertEqual(result['positivePrompt'], service.normalize_art_sections(QWEN3_INLINE_SECTIONS))
        self.assertTrue(result['positivePrompt'].startswith('[风格设定]\n厚涂插画'))
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
        self.assertIn('用户要求（优先落实，写进相关段落，不要单独成段）：画面改为夜晚', prompt)
        self.assertNotIn('用户生成要求', prompt)
        text = result['positivePrompt']
        self.assertEqual(text, service.art_positive_only_wording(service.normalize_art_sections(output)))
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
        self.assertIn('色彩只取图2的配色', prompt)
        self.assertIn('[拍摄参数]：看图1', prompt)
        self.assertEqual(prompt.count('<|vision_start|><|image_pad|><|vision_end|>'), 3)
        self.assertEqual(service.art_five_section_failure(result['positivePrompt']), '')


if __name__ == '__main__':
    unittest.main()
