"""Run the actual wash vision service on one image, keeping its response as evidence."""
import argparse
import base64
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('image', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    queue = json.load(urllib.request.urlopen('http://127.0.0.1:8188/queue', timeout=10))
    if queue['queue_running'] or queue['queue_pending']:
        raise RuntimeError('Runtime busy; no analysis launched')
    request = urllib.request.Request('http://127.0.0.1:8188/free', data=b'{"unload_models":true,"free_memory":true}', headers={'Content-Type': 'application/json'})
    urllib.request.urlopen(request, timeout=15).read()
    payload = {'id': 1, 'command': 'reverseImagePrompt', 'purpose': 'image-wash-style',
               'images': [{'name': args.image.name, 'role': 'source', 'dataUrl': 'data:image/png;base64,' + base64.b64encode(args.image.read_bytes()).decode()}]}
    args.output.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'PYTHONIOENCODING': 'utf-8'}
    # Mirror Electron's configured reverse-model cache path for this real service run.
    runtime = json.loads(Path(r'C:\ProgramData\NovaFlow\AI-Runtime\runtime.json').read_text(encoding='utf-8'))
    if runtime.get('modelsPath'):
        env.setdefault('NOVAFLOW_PROMPT_ASSISTANT_REVERSE_CACHE_PATH', str(Path(runtime['modelsPath']) / 'prompt_assistant/cache/Huihui-Qwen3-VL-8B-Instruct-Abliterated-novaflow-bnb-nf4-v1'))
    started = time.monotonic()
    print('Analyzing source medium, edges, shading, palette and texture...', flush=True)
    # Keep stage diagnostics visible while inference is running and preserve
    # them if the service times out.
    with (args.output / 'analysis-response.jsonl').open('w', encoding='utf-8') as stdout, (args.output / 'analysis-stderr.log').open('w', encoding='utf-8') as stderr:
        result = subprocess.run(
            [r'C:\ProgramData\NovaFlow\AI-Runtime\engine\python\python.exe', str(ROOT / 'particle-editor-desktop/prompt-assistant-service.py')],
            input=json.dumps(payload) + '\n', text=True, encoding='utf-8', errors='replace',
            stdout=stdout, stderr=stderr, cwd=ROOT, env=env, timeout=300,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
        )
    records = [json.loads(line) for line in (args.output / 'analysis-response.jsonl').read_text(encoding='utf-8').splitlines() if line.startswith('{')]
    record = next((r for r in records if r.get('id') == 1), None)
    if result.returncode or not record or not record.get('ok'):
        raise RuntimeError(f'Analysis failed; inspect {args.output / "analysis-response.jsonl"}')
    profile = record['data']['styleProfile']
    (args.output / 'style-profile.json').write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'seconds': round(time.monotonic() - started, 2), 'profile': profile}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
