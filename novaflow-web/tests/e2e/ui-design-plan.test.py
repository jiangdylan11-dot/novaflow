"""Check the shipped UI contract without loading model weights."""
import ast
import re
from pathlib import Path
import unittest

class UiDesignPlanTest(unittest.TestCase):
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
