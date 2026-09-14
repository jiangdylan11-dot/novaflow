"""Exercise the real local reference compiler and retain each response for QA."""
import importlib.util
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
out = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else root / 'docs/h3-multireference-20260914'
out.mkdir(parents=True, exist_ok=True)
request_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else out / 'local-request.json'
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
payload = json.loads(request_path.read_text(encoding='utf8'))
if '--translate-only' in sys.argv:
    display = json.loads((out / 'local-compiled.txt').read_text(encoding='utf8'))['displayPrompt']
    result = assistant.translate_h3_reference(display, payload['requirements'], payload['durationSeconds'])
else:
    result = assistant.optimize_prompt(payload)
(out / 'local-compiled.txt').write_text(result['positivePrompt'], encoding='utf8')
print(json.dumps({'ok': True, 'attempts': attempt, 'chars': len(result['positivePrompt'])}))
for extra in (arg[7:] for arg in sys.argv if arg.startswith('--also=')):
    request_path = (root / extra).resolve()
    out = request_path.parent
    out.mkdir(parents=True, exist_ok=True)
    attempt = 0
    result = assistant.optimize_prompt(json.loads(request_path.read_text(encoding='utf8')))
    (out / 'local-compiled.txt').write_text(result['positivePrompt'], encoding='utf8')
    print(json.dumps({'ok': True, 'case': out.name, 'attempts': attempt, 'chars': len(result['positivePrompt'])}))
