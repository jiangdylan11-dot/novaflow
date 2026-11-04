import base64, importlib.util, io, pathlib, unittest
from PIL import Image

ROOT=pathlib.Path(__file__).resolve().parents[3]
SPEC=importlib.util.spec_from_file_location('natural_ui_draft',ROOT/'particle-editor-desktop/prompt_assistant/natural_ui_draft.py')
module=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(module)
FIX=pathlib.Path(__file__).resolve().parents[1]/'fixtures'

class NaturalDraftTests(unittest.TestCase):
    def test_actual_old_model_outputs_reproduce_both_original_projections(self):
        for case in ['forest','deepsea']:
            raw=(FIX/f'natural-draft-{case}-raw.txt').read_text(encoding='utf-8')
            expected=(FIX/f'natural-draft-{case}-projected.txt').read_text(encoding='utf-8').strip()
            self.assertEqual(module.project_natural(raw)['design_layout_zh'],expected)

    def test_hero_without_avatar_and_repeated_values_on_distinct_hosts(self):
        raw='区域关系：上方独立人物，中间网格，下方控件。\n网格：五行六列。\n角色关联：画面上方有一位独立主角，半身，格内无头像。\n业务文字：左栏“1000”，右栏“1000”，“−”与“+”。\n玩法文字：第1行第5列“SUPER SCATTER”。'
        result=module.project_natural(raw)['design_layout_zh']
        self.assertIn('没有头像',result);self.assertIn('数量：一',result)
        self.assertEqual(result.count('1000'),2);self.assertIn('SUPER SCATTER',result)
        self.assertNotIn('五行五列',result)

    def test_missing_structure_is_not_filled_from_a_known_layout(self):
        for raw in ['', '只有思考内容', '{"网格":']:
            with self.assertRaises(ValueError):module.project_natural(raw)

    def test_numbered_prose_keeps_neutral_facts_and_does_not_correct_conflicting_counts(self):
        raw='"区域1：画面上部为主角与背景，金冠蓝发海神站立。\n区域2：中部为3行2列游戏网格，标“WILD”。\n区域3：底部操控区为三组金额显示，“1000”“1000”“1000”，减号和加号按钮。"\n需核对：行1：物件；行2：物件。'
        result=module.project_natural(raw)['design_layout_zh']
        self.assertIn('计数存在矛盾',result);self.assertNotIn('2行2列',result)
        self.assertNotIn('蓝发',result);self.assertNotIn('海神',result)
        self.assertIn('WILD',result);self.assertEqual(result.count('1000'),3)
        self.assertIn('减号',result)

    def test_recognition_resizes_only_the_copy_and_records_original_bytes(self):
        output=io.BytesIO();Image.new('RGB',(1512,3276)).save(output,format='PNG');original=output.getvalue()
        result=module.prepare_image({'dataUrl':'data:image/png;base64,'+base64.b64encode(original).decode()})
        self.assertEqual(result['proof']['recognitionSize'],[672,1456]);self.assertEqual(result['proof']['originalSize'],[1512,3276])
        self.assertTrue(result['proof']['generationOriginalUnchanged'])

if __name__=='__main__':unittest.main()
