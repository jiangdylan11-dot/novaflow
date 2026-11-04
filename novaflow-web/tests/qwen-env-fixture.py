"""Local fixture: inspect only synthetic environment names, never emit values."""
import json
import os
import sys

def emit(value):
    print(json.dumps(value), flush=True)

emit({'type':'ready'})
for line in sys.stdin:
    item = json.loads(line)
    if item.get('command') == 'shutdown':
        break
    clean = ('RUNNINGHUB_API_KEY' not in os.environ and 'FOART_FAKE_SECRET' not in os.environ
             and 'PYTHONPATH' not in os.environ and 'CUSTOM_TOKEN' not in os.environ)
    ready = bool(os.environ.get('PATH')) and os.environ.get('CUDA_VISIBLE_DEVICES') == '5'
    bridge = os.environ.get('NOVAFLOW_QWEN_STDIO_BRIDGE') == 'v1'
    emit({'id':item['id'],'ok':True,'data':{'style':'fixture-pass' if clean and ready and bridge else 'fixture-failed'}})
