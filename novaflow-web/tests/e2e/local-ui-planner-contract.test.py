import ast
import json
from pathlib import Path
import re
import types
import unittest

REPO=Path(__file__).resolve().parents[3]
SOURCE=REPO/'particle-editor-desktop'/'prompt-assistant-service.py'
REQUEST=json.loads(Path(__file__).with_name('local-ui-planner-contract.fixture.json').read_text(encoding='utf-8'))
TREE=ast.parse(SOURCE.read_text(encoding='utf-8-sig'))
METHOD=next(node for node in ast.walk(TREE) if isinstance(node,ast.FunctionDef) and node.name=='plan_ui_qwen21')
VALIDATOR=next(node for node in TREE.body if isinstance(node,ast.FunctionDef) and node.name=='validate_ui_qwen21_plan')
# Load the actual UI method and its actual schema validator without starting a
# model or importing desktop services. Only inference is replaced for this unit test.
SPACE={'re':re,'json':json,'current_prompt_from_payload':lambda p:p['currentPrompt'],
 'keep_resource_placeholders_once':lambda prompt,current:prompt,
 'ui_design_uses_negative_prompt':lambda payload:payload.get('provider')=='local'}
exec(compile(ast.Module(body=[VALIDATOR,METHOD],type_ignores=[]),str(SOURCE),'exec'),SPACE)

class Capture:
 def __init__(self,plan=None):
  self.plan=plan or {'version':1,'layoutMode':'preserve','layoutReference':1,'visualMode':'theme-redesign',
   'references':[{'index':1,'role':'layout'}],'layoutChanges':[],'preserve':[],'grids':[]}
  self.calls=[]
 def generate(self,text,**kwargs):
  self.calls.append((text,kwargs))
  return json.dumps({'prompt':REQUEST['currentPrompt'],'negative_prompt':'','ui_plan':self.plan})
 plan_ui_qwen21=SPACE['plan_ui_qwen21']

class UiPlannerContract(unittest.TestCase):
 def test_live_request_and_image_pass_through_actual_ui_method(self):
  owner=Capture();tensor=object()
  result=owner.plan_ui_qwen21(REQUEST,[{'role':'layout','tensor':tensor}])
  text,options=owner.calls[0]
  self.assertIn('用户需求：'+REQUEST['currentPrompt'],text)
  self.assertIn(REQUEST['requirements'],text)
  self.assertIs(options['images'][0],tensor)
  self.assertEqual(result['uiPlan']['layoutReference'],1)
  self.assertEqual(result['prompt'],REQUEST['currentPrompt'])
 def test_observed_inventory_is_compatible_with_actual_caller_requirements(self):
  owner=Capture();owner.plan_ui_qwen21(REQUEST,[{'role':'layout','tensor':object()}])
  text=owner.calls[0][0]
  self.assertIn('将准确读到的名称、数值、数量和功能写入最终要求及保留事实',text)
  self.assertIn('另逐项写入preserve',text)
  self.assertIn('不以原数值或原功能保留等泛句代替实际清单',text)
  self.assertIn('确实数清的玩法盘数量与每盘行列写入preserve',text)
  self.assertNotIn('用户或布局器明确指定的数量与位置才写入编辑指令',text)
  rules=text.split('用户需求：',1)[0]
  self.assertNotRegex(rules,r'5[×x]3|5[×x]4|10,000|50,000|99\.00|96\.00|¥1000')
 def test_layout_source_no_guess_and_partial_scope_stay_explicit(self):
  owner=Capture();owner.plan_ui_qwen21(REQUEST,[{'role':'layout','tensor':object()}])
  text=owner.calls[0][0]
  for requirement in ['风格素材图的业务内容不得加入','不填猜测数量或坐标','grids保持空数组','局部修改不允许全局重排','特殊标记可按新主题重做图案外观','有效文字、数值和功能含义保持']:
   self.assertIn(requirement,text)
 def test_existing_schema_and_anchor_repair_are_still_used(self):
  wrong={'version':1,'layoutMode':'create','layoutReference':0,'visualMode':'create',
   'references':[{'index':1,'role':'style'}],'layoutChanges':[],'preserve':[],'grids':[]}
  owner=Capture(wrong)
  result=owner.plan_ui_qwen21(REQUEST,[{'role':'layout','tensor':object()}])
  self.assertEqual(result['uiPlan']['layoutReference'],1)
  self.assertEqual(result['uiPlan']['layoutMode'],'preserve')
  self.assertEqual(result['uiPlan']['visualMode'],'theme-redesign')
  self.assertEqual(result['uiPlan']['references'][0]['role'],'layout')

if __name__=='__main__':unittest.main()
