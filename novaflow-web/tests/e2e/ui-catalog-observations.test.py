"""Synthetic CPU fixtures only. They do not stand in for model validation."""
from pathlib import Path
from copy import deepcopy
import sys, unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'particle-editor-desktop'))
from prompt_assistant.ui_catalog.observed_layout import observed_grid, merge_observations, inspect_observations, repair_business_anchors
from prompt_assistant.ui_catalog.bridge import source_case,design_job,bind_catalog


class Observations(unittest.TestCase):
    def grid(self,r=2,c=3):return {'rows':r,'columns':c,'matrix':[['o|stone']*c for _ in range(r)]}
    def business(self):return {'regions':['panels|A;10|B;20','characters|half','grid','shared_strip|purchase=BUY|information_readout=rule','readouts|numeric_readout=1|adjust_minus=-|numeric_readout=2|adjust_plus=+|numeric_readout=3','controls@center|sound=声音|speed=极速|rotation=|auto=自动|menu=菜单']}
    def test_grid_dimensions_and_identity_are_from_each_input(self):
        for rows,cols in [(2,3),(3,2),(1,2)]:
            source=merge_observations(self.grid(rows,cols),self.business());case=source_case(source)
            self.assertEqual(case['skeleton']['grid']['shape'],[rows,cols]);self.assertEqual(len(source['components']),14)
            self.assertEqual(source['main_character_displays']['count'],1);self.assertEqual(len(source['containers']),6)
    def test_unknown_geometry_and_functions_are_never_filled(self):
        grid=self.grid();grid['matrix'][0].pop()
        with self.assertRaisesRegex(ValueError,'不会转置或补格'):observed_grid(grid)
        business=self.business();business['regions'][-1]='controls@center|rotation=|unknown=oops'
        with self.assertRaisesRegex(ValueError,'功能与所在区域矛盾'):merge_observations(self.grid(),business)
        business=self.business();business['regions'].append('grid')
        with self.assertRaisesRegex(ValueError,'重复声明'):inspect_observations(self.grid(),business)
    def test_exact_source_aliases_and_same_literal_different_carriers(self):
        grid={'rows':1,'columns':3,'matrix':[['s|blue orb|X500','s|gold orb|X500','s|blue orb|X500']]}
        cells=observed_grid(grid)['cells'];self.assertEqual(cells[0]['symbol_id'],cells[2]['symbol_id']);self.assertNotEqual(cells[0]['symbol_id'],cells[1]['symbol_id'])
    def test_field_repair_uses_model_anchors_and_preserves_other_items(self):
        business=self.business();business['regions'].remove('grid');business['regions'][1]='characters|half-submerged figure';business['regions'][-1]=business['regions'][-1].replace('@center','@bottom')
        self.assertTrue(inspect_observations(self.grid(),business)['needsAnchorRepair'])
        answer={'before_grid':'characters','after_grid':'shared_strip','character_framing':'half','rotation_anchor':'center'}
        repaired=repair_business_anchors(business,answer);self.assertEqual(repaired['regions'][2],'grid')
        self.assertEqual(repaired['regions'][0],business['regions'][0]);self.assertEqual(repaired['regions'][3:5],business['regions'][2:4])
        self.assertEqual(merge_observations(self.grid(),repaired)['grid'],observed_grid(self.grid()))
        broken={**answer,'after_grid':'controls'}
        with self.assertRaisesRegex(ValueError,'相邻源区域'):repair_business_anchors(business,broken)
    def test_multiple_explicit_characters_do_not_need_single_person_repair(self):
        business=self.business();business['regions'][1]='characters|half|full|portrait'
        self.assertFalse(inspect_observations(self.grid(),business)['needsAnchorRepair'])
        self.assertEqual(source_case(merge_observations(self.grid(),business))['skeleton']['main_character_displays']['count'],3)


if __name__=='__main__':unittest.main()
