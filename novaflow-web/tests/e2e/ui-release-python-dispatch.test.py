import ast
import json
import os
import sys
from pathlib import Path

desktop = Path(os.environ.get('NOVAFLOW_TEST_DESKTOP_ROOT') or Path(__file__).resolve().parents[3] / 'particle-editor-desktop')
sys.path.insert(0, str(desktop))
tree = ast.parse((desktop / 'prompt-assistant-service.py').read_text(encoding='utf-8-sig'))
owner = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'PromptAssistant')
method = next(node for node in owner.body if isinstance(node, ast.FunctionDef) and node.name == 'reverse_image_prompt')
scope = {
    'minimax_h3_reverse_mode_from_purpose': lambda value: None,
    'is_animation_prompt_payload': lambda value: False,
    'is_ui_design_prompt_payload': lambda value: True,
    'current_prompt_from_payload': lambda value: '',
    'clean_text': str,
    'data_url_to_tensor': lambda value: 'CPU_DECODE_STUB',
}
exec(compile(ast.fix_missing_locations(ast.Module(body=[method], type_ignores=[])), '<actual-packaged-reverse-dispatch>', 'exec'), scope)

class VisionStub:
    def __init__(self):
        self.calls = []

    def generate(self, prompt, **options):
        self.calls.append(options)
        return json.dumps({'schema': 'nf.ui.split.v1', 'style': 'painted', 'regions': [{'id': 'r1', 'name': 'icon', 'kind': 'object', 'box': [10, 20, 200, 300]}]})

model = VisionStub()
request = {'images': [{'dataUrl': 'CPU_IMAGE_STUB'}], 'surface': 'ui-design', 'purpose': 'ui-layer-proposal', 'visualSchema': 'nf.ui.split.v1'}
result = scope['reverse_image_prompt'](model, request)
assert result['proposal']['schema'] == 'nf.ui.split.v1'
assert result['maskProduced'] is False
assert len(model.calls) == 1 and model.calls[0]['max_length'] == 3072
assert model.calls[0]['images'] == ['CPU_DECODE_STUB']
try:
    scope['reverse_image_prompt'](model, {**request, 'visualSchema': 'invalid'})
    raise AssertionError('Invalid split schema was accepted')
except ValueError:
    pass
assert len(model.calls) == 1
print(json.dumps({'actualPythonSplitDispatch': True, 'schemaRejectedBeforeModel': True, 'realModelCalls': 0, 'gpuSubmissions': 0}))
