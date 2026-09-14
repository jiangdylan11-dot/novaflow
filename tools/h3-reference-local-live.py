"""Exercise the real local reference compiler and retain each response for QA."""
import importlib.util
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
out = root / 'docs/h3-multireference-20260914'
sys.path.insert(0, str(root / 'particle-editor-desktop'))
spec = importlib.util.spec_from_file_location('reference_live', root / 'particle-editor-desktop/prompt-assistant-service.py')
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)
assistant = service.PromptAssistant()
generate = assistant.generate
attempt = 0
def capture(*args, **kwargs):
    global attempt
    attempt += 1
    result = generate(*args, **kwargs)
    (out / f'local-raw-{attempt}.txt').write_text(result, encoding='utf8')
    return result
assistant.generate = capture
result = assistant.optimize_prompt(json.loads((out / 'local-request.json').read_text(encoding='utf8')))
(out / 'local-compiled.txt').write_text(result['positivePrompt'], encoding='utf8')
print(json.dumps({'ok': True, 'attempts': attempt, 'chars': len(result['positivePrompt'])}))
