"""Narrow CPU label attachment projection; no model or runtime I/O."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'particle-editor-desktop'))
from prompt_assistant.ui_native.design_core import (
    bind_catalog, bind_functional_art, build_case, project_auxiliary_label_attachment,
)

FIXTURE = json.loads((Path(__file__).resolve().parents[1] / 'fixtures/ui-flash-native-field-v7-actual.json').read_text(encoding='utf-8'))
digest = lambda text: hashlib.sha256(text.encode('utf-8')).hexdigest()


class AuxiliaryLabelProjection(unittest.TestCase):
    def test_actual_ui7_changes_only_explicit_label_attachment(self):
        catalog = copy.deepcopy(FIXTURE['catalog'])
        before = copy.deepcopy(catalog)
        fragments, proof = bind_functional_art(catalog, FIXTURE['source'])
        self.assertEqual(catalog, before, 'Native catalog must remain unchanged')
        self.assertEqual(len(proof), 1)
        projected = fragments['auxiliary_art_and_type']
        self.assertEqual(projected, catalog['AUXILIARY_ART'].replace('在按钮顶部', ''))
        self.assertIn('以亮银管状笔画蚀刻', projected)
        self.assertIn('深灰金属面板', projected)
        self.assertIn('"菜单""极速""自动""声音"', projected)
        record = proof[0]
        self.assertEqual(record['beforeSHA256'], digest(catalog['AUXILIARY_ART']))
        self.assertEqual(record['afterSHA256'], digest(projected))
        self.assertFalse(record['insertedArtText'])
        self.assertEqual(record['providerCalls'], 0)
        self.assertIn('fixed CPU rule', record['rule']['authority'])
        self.assertNotIn('source visual measured', record['rule']['authority'])
        self.assertEqual([x['text'] for x in record['removedSpans']], ['在按钮顶部'])
        for item in record['removedSpans']:
            self.assertEqual(catalog['AUXILIARY_ART'][slice(*item['span'])], item['text'])

    def test_actual_ui7_compiles_with_all_source_business_unchanged(self):
        source = copy.deepcopy(FIXTURE['source'])
        catalog = copy.deepcopy(FIXTURE['catalog'])
        source_id = next(x['requestId'] for x in FIXTURE['records'] if x['stage'] == 'source-controls')
        case, keys, fields, bindings = build_case(source, FIXTURE['request'], source_id, FIXTURE['sourceImageSHA256'])
        prompt, proof = bind_catalog(case, catalog, fields, bindings, source)
        self.assertEqual(prompt, FIXTURE['originalCompiledPrompt'].replace('在按钮顶部', ''))
        self.assertNotIn('蚀刻在按钮顶部', prompt)
        self.assertIn('每个既有图标正下方只印各自一项清楚中文标签', prompt)
        self.assertEqual(catalog, FIXTURE['catalog'])
        self.assertEqual(source, FIXTURE['source'])
        self.assertEqual(proof['compile']['inventory']['shape'], [4, 5])
        self.assertEqual(proof['compile']['inventory']['cells'], 20)
        self.assertEqual(proof['compile']['inventory']['main_count'], 3)
        self.assertEqual(proof['compile']['inventory']['amount_count'], 3)
        self.assertEqual(proof['compile']['business_guard']['errors'], [])
        self.assertEqual(proof['sourceLiteralProjection'], [])
        self.assertEqual(len(proof['functionalStyleProjection']), 1)
        self.assertEqual(proof['functionalStyleProjection'][0]['kind'], 'label-attachment-only')
        self.assertIn('小徽标为品红小圆点', prompt, 'Unrelated badge risk must not be silently edited')
        for literal in ['BUY FREE GAMES', 'WIN 20.00', '¥1000', 'WILD', '菜单', '极速', '自动', '声音']:
            self.assertIn(literal, prompt)

    def test_surface_and_texture_subjects_are_untouched(self):
        originals = [
            '按钮顶部高光与倒角清晰；标签采用亮银蚀刻。',
            '标签采用银色，按钮顶部高光与倒角清晰。',
            '标签纹理蚀刻在按钮顶部。',
            '标签的高光绘制在按钮顶部。',
            '标签背景绘制在按钮顶部。',
            '标签使用银色且按钮顶部高光印在按钮顶部。',
            '标签的材质为金属；图标在按钮顶部排列。',
        ]
        for value in originals:
            with self.subTest(value=value):
                self.assertEqual(project_auxiliary_label_attachment(value), (value, None))

    def test_quoted_literal_and_quoted_label_terms_are_untouched(self):
        originals = [
            '按钮上的字样是“刻在按钮顶部”，必须逐字保留。',
            '标签字面为"刻在按钮顶部"，不改字面。',
            '“标签”纹理蚀刻在按钮顶部。',
            '说明文字“标签蚀刻在按钮顶部”不可删改。',
            '标签字面为\'刻在图标上方\'。',
        ]
        for value in originals:
            with self.subTest(value=value):
                self.assertEqual(project_auxiliary_label_attachment(value), (value, None))

    def test_only_location_is_removed_from_explicit_label_predicate(self):
        for value, location in [
            ('菜单标签以亮银字体印在图标上方。', '在图标上方'),
            ('中文标签以青色字形蚀刻于按钮的顶端。', '于按钮的顶端'),
            ('字样置在对应的图标右侧。', '在对应的图标右侧'),
        ]:
            with self.subTest(value=value):
                after, proof = project_auxiliary_label_attachment(value)
                self.assertEqual(after, value.replace(location, ''))
                self.assertEqual(proof['removedSpans'][0]['text'], location)

    def test_valid_below_icon_and_ambiguous_prose_are_untouched(self):
        for value in [
            '四个中文标签位于各按钮正面下方，采用冷银白笔画。',
            '文字标签蚀刻在图标下方。',
            '按钮顶部蚀刻标签，采用银色。',
            '在按钮顶部蚀刻标签，采用银色。',
            '标签采用顶部高光与拉丝材料。',
        ]:
            with self.subTest(value=value):
                self.assertEqual(project_auxiliary_label_attachment(value), (value, None))

    def test_no_source_auxiliary_contract_never_projects(self):
        catalog = {'AUXILIARY_ART': '标签以亮银字体印在图标上方。'}
        fragments, proof = bind_functional_art(catalog, {'aux': []})
        self.assertEqual(fragments, {})
        self.assertEqual(proof, [])

    def test_unicode_spans_are_explicit_codepoints(self):
        text = '✨标签以银色蚀刻在按钮顶部；按钮顶部有高光。'
        after, proof = project_auxiliary_label_attachment(text)
        self.assertEqual(after, '✨标签以银色蚀刻；按钮顶部有高光。')
        item = proof['removedSpans'][0]
        self.assertEqual(item['spanUnit'], 'unicode-codepoints')
        self.assertEqual(text[slice(*item['span'])], '在按钮顶部')


if __name__ == '__main__':
    unittest.main()
