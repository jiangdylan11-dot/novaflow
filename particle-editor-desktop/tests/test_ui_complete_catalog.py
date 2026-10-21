import unittest
import json
from pathlib import Path
from prompt_assistant.natural_ui_draft import project_natural,complete_catalog_job,compile_complete_catalog

class CompleteCatalog(unittest.TestCase):
    def setUp(self):
        self.raw=(Path(__file__).parent/'fixtures/ui-source-neptune-pe-real.txt').read_text(encoding='utf-8')
        self.project=project_natural(self.raw)
        self.job=complete_catalog_job(self.project,'参考布局，白雪公主主题老虎机')
        self.catalog={key:'一套完整目标美术 '+key for key in self.job['output_keys']}
        for i in range(1,4):self.catalog['OBJECT'+str(i)]='名称：新物件'+str(i)+'；造型：新物件'+str(i)+'的完整形象。'
        self.catalog['MAIN_CHARACTER1']='名称：新角色；展示：新角色保持原裁切的完整形象。'
        for key,literal in self.job['context']['specials'].items():self.catalog[key]='名称：载体'+key+'；造型：载体'+key+'含「'+literal+'」。'
    def test_actual_observation_preserves_hosts_not_source_identity(self):
        hosts=self.project['business_bindings']
        self.assertEqual([x['kind'] for x in hosts],['information_panels','grid_labels','purchase_rule_strip','readouts_controls'])
        self.assertEqual(hosts[0]['literals'],['GRAND','1000','MAJOR','1000','MINOR','1000','MINI','1000'])
        self.assertEqual(hosts[2]['literals'],['BUY FREE GAME','2 or more','BONUS','trigger bo'])
        self.assertEqual(hosts[3]['readouts'],['¥1000','¥1000','¥1000'])
        self.assertEqual([x['function'] for x in hosts[3]['auxiliaries']],['sound','speed','auto','menu'])
        self.assertTrue(hosts[3]['rotation']);self.assertTrue(hosts[3]['minus']);self.assertTrue(hosts[3]['plus'])
        self.assertNotIn('海神',str(self.job['context']['source_structure']))
        self.assertNotIn('6行6列',self.project['design_layout_zh'])
    def test_observed_readout_icons_remain_with_their_own_amount(self):
        r9=(Path(__file__).parent/'fixtures/ui-source-neptune-pe-r9-real.txt').read_text(encoding='utf-8')
        hosts=project_natural(r9)['business_bindings']
        items=next(x for x in hosts if x['kind']=='readouts_controls')['readout_items']
        self.assertEqual(sum(x.get('functional_icon')=='wallet' for x in items),1)
        self.assertEqual(sum(x.get('badge_literal')=='WIN' for x in items),1)
        self.assertTrue(all(x['function']=='numeric_readout' for x in items if x.get('functional_icon') or x.get('badge_literal')))
    def test_catalog_cpu_binding_preserves_ai_art_and_actual_functions(self):
        result=compile_complete_catalog(self.job['case'],self.catalog)
        for key,text in self.catalog.items():
            self.assertIn(text.split('展示：',1)[1] if key.startswith('MAIN_CHARACTER') else text,result['prompt'])
        self.assertIn('另有4个独立辅助按钮',result['prompt'])
        self.assertTrue(result['proof']['reference_geometry_only'])
        self.assertEqual(result['proof']['inventory']['amount_count'],3)
        self.assertEqual(result['proof']['inventory']['main_count'],1)
    def test_foreign_host_and_gameplay_geometry_are_rejected(self):
        carrier='CARRIER5'
        bad={**self.catalog,carrier:'BUY FREE GAME 配 GRAND 与 MAJOR'}
        with self.assertRaisesRegex(ValueError,'其他宿主'):compile_complete_catalog(self.job['case'],bad)
        with self.assertRaisesRegex(ValueError,'网格结构'):compile_complete_catalog(self.job['case'],{**self.catalog,'OBJECT1':'改为4行5列'})
        with self.assertRaisesRegex(ValueError,'主旋转'):compile_complete_catalog(self.job['case'],{**self.catalog,'AUXILIARY_ART':'火箭图标即旋转盘主体'})
    def test_both_accepted_neon_prompts_remain_byte_exact(self):
        from prompt_assistant.ui_catalog.bridge import design_job,bind_catalog
        cases=json.loads((Path(__file__).parent/'fixtures/approved-neon-complete-cpu.json').read_text(encoding='utf-8'))
        for item in cases:
            with self.subTest(provider=item['provider']):
                keys=design_job(item['case'],'')['output_keys']
                self.assertEqual(len(keys),14)
                catalog={key:item['catalog'][{'CARRIER1':'SHARED_STRIP','SPECIAL1':'SPECIAL_WILD'}.get(key,key)] for key in keys}
                result=bind_catalog(item['case'],catalog)
                self.assertEqual(result['prompt'],item['expectedPrompt'])
                self.assertIn(item['catalog']['AUXILIARY_ART'],result['prompt'])
    def test_actual_model_r9_is_rejected_without_art_rewrite_or_sampling(self):
        root=Path(__file__).parent/'fixtures'
        projection=project_natural((root/'ui-source-neptune-pe-r9-real.txt').read_text(encoding='utf-8'))
        job=complete_catalog_job(projection,'参考布局，白雪公主主题')
        catalog=json.loads((root/'ui-neptune-pe-r9-real-art.json').read_text(encoding='utf-8'))
        with self.assertRaisesRegex(ValueError,'被动显示面混入操作职责'):
            compile_complete_catalog(job['case'],catalog)
    def test_missing_main_control_is_not_backfilled(self):
        no_rotation=self.raw.replace('双向循环箭头','静态星形')
        with self.assertRaisesRegex(ValueError,'主旋转'):project_natural(no_rotation)

if __name__=='__main__':unittest.main()
