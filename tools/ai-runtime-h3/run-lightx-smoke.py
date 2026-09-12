"""Submit an acceptance fixture and persist complete ComfyUI execution evidence."""
import argparse
import json
import time
import urllib.request
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('fixture', type=Path)
parser.add_argument('--url', default='http://127.0.0.1:8189')
args = parser.parse_args()

def request(route, data=None):
    payload = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(args.url + route, data=payload, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.load(response)

fixture = json.loads(args.fixture.read_text(encoding='utf-8'))
queue = request('/queue')
if queue['queue_running'] or queue['queue_pending']:
    raise RuntimeError('Runtime is busy; acceptance will not interleave with other work')
info = request('/object_info')
for node in fixture['prompt'].values():
    if node['class_type'] not in info:
        raise RuntimeError('Missing node: ' + node['class_type'])
started = time.time()
submission = request('/prompt', {'prompt': fixture['prompt'], 'client_id': 'novaflow-h3-lightx-acceptance'})
pid = submission['prompt_id']
result_path = args.fixture.with_suffix('.result.json')
evidence = {'prompt_id': pid, 'started': started, 'submission': submission, 'options': fixture['options']}
result_path.write_text(json.dumps(evidence, indent=2), encoding='utf-8')
print('SUBMITTED ' + pid, flush=True)
while time.time() - started < 7200:
    history = request('/history/' + pid)
    if pid in history:
        evidence.update(elapsed_seconds=round(time.time()-started, 2), history=history[pid])
        result_path.write_text(json.dumps(evidence, indent=2), encoding='utf-8')
        status = history[pid]['status']
        print(json.dumps({'result': str(result_path), 'elapsed_seconds': evidence['elapsed_seconds'], 'status': status, 'outputs': history[pid]['outputs']}), flush=True)
        raise SystemExit(0 if status.get('status_str') == 'success' else 1)
    time.sleep(5)
raise TimeoutError('Acceptance job exceeded two hours; inspect persisted prompt id before retrying')
