"""One JSON request, CPU only; model calls belong to the normal worker queue."""
import json
import sys
from prompt_assistant.ui_catalog.bridge import source_case, design_job, bind_catalog, RECOGNITION_RULES

from prompt_assistant.ui_catalog.observed_layout import observed_grid, merge_observations, repair_business_anchors, inspect_observations, GRID_RULES, GRID_TASK, BUSINESS_RULES, BUSINESS_TASK, ANCHOR_RULES, ANCHOR_TASK

if hasattr(sys.stdin, 'reconfigure'):
    sys.stdin.reconfigure(encoding='utf-8')

def main():
    value = json.load(sys.stdin)
    action = value['action']
    if action.startswith('native-ui-'):
        from prompt_assistant.ui_native.service import dispatch
        result=dispatch(value)
    elif action in ['grok-vision-job','compile-grok-vision']:
        from prompt_assistant.grok_ui_vision import build_job,compile_plan
        result=build_job(value) if action=='grok-vision-job' else compile_plan(value)
    elif action in ['natural-draft-image','natural-draft-project']:
        from prompt_assistant.natural_ui_draft import prepare_image,project_natural
        result=prepare_image(value['image']) if action=='natural-draft-image' else project_natural(value['raw'])
    elif action == 'inspect-complete-natural':
        from prompt_assistant.ui_reference_catalog import inspect_catalog
        result=inspect_catalog(value['case'],value['catalog'])
    elif action in ['complete-natural-job','compile-complete-natural']:
        from prompt_assistant.natural_ui_draft import complete_catalog_job,compile_complete_catalog
        result=complete_catalog_job(value['projection'],value['request']) if action=='complete-natural-job' else compile_complete_catalog(value['case'],value['catalog'])
    elif action == 'recognition-rules': result = {'rules':RECOGNITION_RULES,'gridRules':GRID_RULES,'gridTask':GRID_TASK,'businessRules':BUSINESS_RULES,'businessTask':BUSINESS_TASK,'anchorRules':ANCHOR_RULES,'anchorTask':ANCHOR_TASK}
    elif action == 'observed-grid-check': result = observed_grid(value['source'])
    elif action == 'inspect-observations': result = inspect_observations(value['grid'],value['business'])
    elif action == 'merge-observed-job':
        business = repair_business_anchors(value['business'],value['anchors']) if 'anchors' in value else value['business']
        result = design_job(source_case(merge_observations(value['grid'],business)),value['request'])
    elif action == 'design-job': result = design_job(source_case(value['source']), value['request'])
    elif action == 'compile': result = bind_catalog(value['case'],value['catalog'])
    else: raise ValueError('Unknown UI catalog CPU action')
    print(json.dumps({'ok':True,'data':result},ensure_ascii=True))

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'ok':False,'error':str(error)},ensure_ascii=True)); sys.exit(1)
