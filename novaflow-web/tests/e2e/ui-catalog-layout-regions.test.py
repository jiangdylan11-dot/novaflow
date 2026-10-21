"""Pure CPU schema/compiler checks. Manual fixtures are not model responses."""
from pathlib import Path
from copy import deepcopy
import json, os, sys, unittest

HERE = Path(__file__).resolve().parent
DESKTOP = Path(os.environ.get('NOVAFLOW_TEST_CATALOG_DESKTOP_ROOT', str(HERE.parents[1]/'../particle-editor-desktop'))).resolve()
FIXTURES = Path(os.environ.get('NOVAFLOW_TEST_CATALOG_FIXTURES', str(HERE.parent/'fixtures')))
sys.path.insert(0, str(DESKTOP))
from prompt_assistant.ui_catalog.bridge import source_case, design_job, bind_catalog


def stub_art(job):
    result = {}
    for key in job['output_keys']:
        if key == 'ENVIRONMENT_ART': value = 'CPU测试桩：童话森林环境与柔和光照。'
        elif key.startswith('OBJECT'): value = '名称：测试物件'+key[6:]+'；造型：测试物件'+key[6:]+'保留清楚固有色与体积'
        elif key.startswith('MAIN_CHARACTER'): value = '名称：新主题主角；展示：新主题服装装备，按源区域和原裁切展示半身'
        elif key.startswith('SPECIAL'): value = '名称：测试特殊载体'+key[7:]+'；造型：童话载体保留文字“'+job['context']['specials'][key]+'”'
        elif key.startswith('CARRIER'): value = 'CPU测试桩：清楚的新主题承托和字形。'
        else: value = 'CPU测试桩：保留清楚的功能字形与动作图标。'
        result[key] = value
    return result


class LayoutRegions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = json.loads((FIXTURES/'ui-layout-groups-manual.json').read_text(encoding='utf-8'))
        cls.source = cls.fixture['source']
        cls.failed = json.loads((FIXTURES/'ui-layout-groups-failed.json').read_text(encoding='utf-8'))

    def test_manual_actual_layout_compiles_without_being_called_model_recognition(self):
        self.assertIn('not a model response', self.fixture['evidence']['kind'])
        case = source_case(self.source)
        job = design_job(case, '只参考布局，做新主题')
        result = bind_catalog(case, stub_art(job))
        self.assertFalse(result['proof']['business_guard']['errors'])
        self.assertTrue(result['proof']['grid_roundtrip'])
        self.assertIn('严格5行6列共30格', result['prompt'])
        self.assertIn('严格展示1位新主题主角', result['prompt'])
        self.assertIn('半身', result['prompt'])
        self.assertIn('顶部四档奖池、上部独立主角、玩法网格、购买与规则长栏、金额与加减行、底部主控', result['prompt'])
        self.assertEqual(result['proof']['inventory']['amount_count'], 3)
        self.assertEqual(sum(k.startswith('CARRIER') for k in job['output_keys']), 5)
        self.assertEqual(sum(k.startswith('MAIN_CHARACTER') for k in job['output_keys']), 1)
        self.assertIn('信息显示内嵌同款', result['prompt'])

    def test_actual_failed_response_is_not_repaired_into_an_accepted_case(self):
        with self.assertRaisesRegex(ValueError, '重复展示'):
            source_case(self.failed)

    def test_unsupported_groups_contradictions_and_missing_members_remain_errors(self):
        cases = []
        s = deepcopy(self.source); s['grid']['shape'] = [6,5]; cases.append((s,'行列声明矛盾'))
        s = deepcopy(self.source); s['grid']['row_lengths'] = [5]*6; cases.append((s,'逐行格数'))
        s = deepcopy(self.source); s['containers'][4]['children'].append('spin'); cases.append((s,'玩法网格分组'))
        s = deepcopy(self.source); s['containers'][0]['type'] = 'unknown_visual_wrapper'; cases.append((s,'unknown_visual_wrapper'))
        s = deepcopy(self.source); s['regions']['order'].remove('hero'); cases.append((s,'区域顺序'))
        s = deepcopy(self.source); s['regions']['items'][3]['container_ids'].append('main_controls'); cases.append((s,'区域用途矛盾'))
        s = deepcopy(self.source); s['components'][0]['interaction_type']='action'; cases.append((s,'非交互信息面板'))
        s = deepcopy(self.source); s['components'][5]['inline_symbol_id']='unknown'; cases.append((s,'未知的玩法符号'))
        for candidate, error in cases:
            with self.subTest(error=error), self.assertRaisesRegex(ValueError,error): source_case(candidate)

    def test_same_literal_special_carriers_keep_distinct_identity_and_exact_cells(self):
        job = design_job(source_case(self.source), 'new theme')
        result = bind_catalog(job['case'],stub_art(job))
        self.assertIn('测试特殊载体4“X500”',result['prompt'])
        self.assertIn('测试特殊载体5“X500”',result['prompt'])
        broken=stub_art(job)
        for key in ['SPECIAL4','SPECIAL5']:broken[key]='倍率载体保留“X500”'
        with self.assertRaisesRegex(ValueError,'同字面不同特殊载体'):bind_catalog(job['case'],broken)

    def test_standalone_character_cannot_be_omitted(self):
        job = design_job(source_case(self.source), 'new theme')
        art=stub_art(job);del art['MAIN_CHARACTER1']
        with self.assertRaisesRegex(ValueError,'美术字段不完整'):bind_catalog(job['case'],art)

    def test_exact_glyph_canonicalization_keeps_explicit_grid_references_consistent(self):
        for full_instances in [True, False]:
            source=deepcopy(self.source)
            original=[c['symbol_id'] for c in source['grid']['cells']]
            for i,c in enumerate(source['grid']['cells']):
                c.update(symbol_id='glyph_'+str(i%4),category='g',literal='J' if i%2 else 'K')
            members=[c['symbol_id'] for c in source['grid']['cells']]
            grid=next(x for x in source['containers'] if x['type']=='grid_container')
            grid['children']=members if full_instances else list(dict.fromkeys(members))
            for c in source['components']: c.pop('inline_symbol_id',None)
            case=source_case(source)
            self.assertEqual(len({c['symbol_id'] for c in case['skeleton']['grid']['cells']}),2)
            self.assertIn(grid['id'],[x['id'] for x in case['skeleton']['containers']])

    def test_same_named_distinct_special_art_uses_structural_references_without_word_edits(self):
        job=design_job(source_case(self.source),'new theme');art=stub_art(job)
        art['SPECIAL4']='名称：倍率载体；造型：蓝色水球保留“X500”'
        art['SPECIAL5']='名称：倍率载体；造型：金色光球保留“X500”'
        result=bind_catalog(job['case'],art)
        self.assertTrue(result['proof']['grid_roundtrip'])
        self.assertEqual(len(result['proof']['structural_alias_disambiguation']),1)
        self.assertIn(art['SPECIAL4'],result['prompt']);self.assertIn(art['SPECIAL5'],result['prompt'])
        self.assertEqual(result['proof']['structural_alias_disambiguation'][0]['art_word_edits'],0)
        art['SPECIAL5']=art['SPECIAL4']
        with self.assertRaisesRegex(ValueError,'美术描述完全相同'):bind_catalog(job['case'],art)

    def test_geometry_is_data_driven_not_frozen_to_this_image(self):
        for rows, columns in [(2,3),(3,2),(1,2)]:
            cells=[{'row':r+1,'column':c+1,'symbol_id':'o'+str(r*columns+c),'category':'o','literal':''} for r in range(rows) for c in range(columns)]
            source={'schema':'nf.ui.recognition.v2','grid':{'rows':rows,'columns':columns,'row_lengths':[columns]*rows,'cells':cells},'main_character_displays':{'count':0,'items':[]},'regions':{'order':['play'],'items':[{'id':'play','kind':'grid','label':'玩法区域','container_ids':['grid']}]},'components':[],'containers':[{'id':'grid','type':'grid_container','children':[c['symbol_id'] for c in cells]}]}
            job=design_job(source_case(source),'new theme');result=bind_catalog(job['case'],stub_art(job))
            self.assertIn('严格'+str(rows)+'行'+str(columns)+'列共'+str(rows*columns)+'格',result['prompt'])


if __name__ == '__main__': unittest.main()
