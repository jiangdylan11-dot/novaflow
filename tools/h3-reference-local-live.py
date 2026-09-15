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
instruction_adapter = None
if '--qwen3' in sys.argv:
    instruction_adapter = service.Qwen3VLAbliteratedAdapter(assistant.reverse_model_path(), max_new_tokens=1800)
    def generate(prompt, **kwargs):
        frames = kwargs.get('images') or []
        if len(frames) > 1:
            raise ValueError('This probe observes media separately')
        template = kwargs.get('llama_template', '')
        system = template.split('<|im_start|>system\n')[-1].split('<|im_end|>')[0]
        prompt = prompt.replace('<|vision_start|><|image_pad|><|vision_end|>', '')
        return instruction_adapter.generate(prompt, frames[0] if frames else None, system_text=system,
            unload_after=False, max_new_tokens=kwargs.get('max_length', 1800), do_sample=kwargs.get('do_sample', False), temperature=kwargs.get('temperature', .1))
attempt = 0
prefix = next((Path(arg.split('=', 1)[1]).resolve() for arg in sys.argv if arg.startswith('--replay-prefix=')), None)
def capture(*args, **kwargs):
    global attempt
    attempt += 1
    replay_dir = prefix / out.name if prefix and (prefix / out.name).is_dir() else prefix
    if replay_dir and attempt == 1:
        previous = json.loads((replay_dir / 'local-request.json').read_text(encoding='utf8'))
        if any(previous.get(key) != payload.get(key) for key in ('prompt', 'durationSeconds', 'h3ReferenceFrames')):
            raise ValueError('Replay source media or user request does not match')
    replay = replay_dir / f'local-raw-{attempt}.txt' if replay_dir and kwargs.get('trace_label') in ('minimaxH3ReferenceObserve', 'minimaxH3ReferenceEnhance') else None
    recorded_call = replay_dir / f'local-call-{attempt}.json' if replay_dir else None
    if replay and (not recorded_call.exists() or json.loads(recorded_call.read_text(encoding='utf8')).get('stage') != kwargs.get('trace_label')):
        replay = None
    result = replay.read_text(encoding='utf8') if replay and replay.exists() else generate(*args, **kwargs)
    (out / f'local-raw-{attempt}.txt').write_text(result, encoding='utf8')
    (out / f'local-call-{attempt}.json').write_text(json.dumps({'stage': kwargs.get('trace_label'), 'replayed': bool(replay and replay.exists())}), encoding='utf8')
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
    payload = json.loads(request_path.read_text(encoding='utf8'))
    result = assistant.optimize_prompt(payload)
    (out / 'local-compiled.txt').write_text(result['positivePrompt'], encoding='utf8')
    print(json.dumps({'ok': True, 'case': out.name, 'attempts': attempt, 'chars': len(result['positivePrompt'])}))
if instruction_adapter is not None:
    instruction_adapter.unload()
