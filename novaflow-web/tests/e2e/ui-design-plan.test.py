"""Check the shipped UI contract without loading model weights."""
import ast
import re
import json
from pathlib import Path
import unittest

class UiDesignPlanTest(unittest.TestCase):
    def test_qwen_contract_rejects_incomplete_scope_and_accepts_partial_layout(self):
        path = Path(__file__).resolve().parents[3] / 'particle-editor-desktop/prompt-assistant-service.py'
        tree = ast.parse(path.read_text(encoding='utf-8-sig'))
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'validate_ui_qwen21_plan')
        scope = {'re': re}
        exec(compile(ast.Module(body=[fn], type_ignores=[]), str(path), 'exec'), scope)
        validate = scope['validate_ui_qwen21_plan']
        good = dict(version=1, layoutMode='partial', layoutReference=1, visualMode='theme-redesign',
                    references=[dict(index=1, role='layout')], layoutChanges=['人物缩小20%'], preserve=['其他区域保持原位'])
        self.assertEqual(validate(good, 1), good)
        self.assertEqual(validate(dict(good, grids=[dict(description='符号',columns=6,rows=5)]),1)['grids'][0]['rows'],5)
        for patch in [dict(preserve=[]), dict(layoutMode='preserve'), dict(layoutReference=True), dict(references=[]), dict(visualMode='unknown'), dict(grids=[dict(description='符号',columns=6,rows=True)]), dict(grids=[dict(description='符号',columns=0,rows=5)])]:
            with self.assertRaisesRegex(ValueError, '规划不完整'):
                validate(dict(good, **patch), 1)

    def test_local_qwen_planner_returns_json_contract_without_loading_weights(self):
        path = Path(__file__).resolve().parents[3] / 'particle-editor-desktop/prompt-assistant-service.py'
        tree = ast.parse(path.read_text(encoding='utf-8-sig'))
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'validate_ui_qwen21_plan')
        method = next(n for c in tree.body if isinstance(c, ast.ClassDef) for n in c.body if isinstance(n, ast.FunctionDef) and n.name == 'plan_ui_qwen21')
        scope = {'json':json, 're':re, 'current_prompt_from_payload':lambda p:p['prompt'],
                 'ui_design_uses_negative_prompt':lambda p:True,
                 'keep_resource_placeholders_once':lambda text, source:text}
        exec(compile(ast.Module(body=[fn, method], type_ignores=[]), str(path), 'exec'), scope)
        plan = dict(version=1,layoutMode='create',layoutReference=0,visualMode='create',references=[],layoutChanges=[],preserve=[])
        class Model:
            def generate(self, prompt, **kwargs):
                self.input = prompt
                return json.dumps(dict(prompt='糖果主题UI', ui_plan=plan, negative_prompt='不要模糊'))
        model = Model()
        result = scope['plan_ui_qwen21'](model, dict(prompt='糖果乐园', requirements='完整界面'))
        self.assertEqual(result['uiPlan'],plan)
        self.assertEqual(result['negativePrompt'],'不要模糊')
        self.assertIn('糖果乐园',model.input)
        model.generate = lambda prompt, **kwargs: json.dumps(dict(prompt='生肖牛老虎机UI', ui_plan=dict(
            version=1, layoutMode='create', layoutReference=0, visualMode='create',
            references=[dict(index=1, role='style')], layoutChanges=[], preserve=[])))
        recovered = scope['plan_ui_qwen21'](model, dict(prompt='参考图1的布局，生成生肖牛老虎机', uiPreserveLayout=True,
            uiDesignIntent='redesign'), [dict(role='reference', tensor='image')])
        self.assertEqual(recovered['uiPlan']['layoutMode'], 'preserve')
        self.assertEqual(recovered['uiPlan']['references'], [dict(index=1, role='layout')])

    def test_ui_contract_rejects_drawing_and_empty_regions(self):
        path = Path(__file__).resolve().parents[3] / 'particle-editor-desktop/prompt-assistant-service.py'
        tree = ast.parse(path.read_text(encoding='utf-8-sig'))
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'validate_ui_design_plan')
        scope = {'re': re}
        exec(compile(ast.Module(body=[fn], type_ignores=[]), str(path), 'exec'), scope)
        validate = scope['validate_ui_design_plan']
        good = '\n'.join(f'[{title}]\n{body}' for title, body in [
            ('界面目标', '埃及木乃伊老虎机。'), ('参考用途', '图1只借鉴功能关系。'),
            ('布局与功能', '上方奖池、中间符号、底部操作。'), ('区域设计', '沙漠神殿、圣甲虫符号和石板面板。'),
            ('视觉规范', '沙金与青蓝色、文字清晰、按钮等距。')])
        self.assertEqual(validate(good), good)
        for bad in ['木乃伊法老立于波涛之上。', good.replace('沙漠神殿、圣甲虫符号和石板面板。', ''), good + '\n[环境背景]海浪']:
            with self.assertRaisesRegex(ValueError, 'UI 设计方案不完整'):
                validate(bad)

if __name__ == '__main__':
    unittest.main()
