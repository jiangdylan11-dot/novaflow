"""One JSON request, CPU only; model calls belong to the normal worker queue."""
import json
import sys
from prompt_assistant.ui_catalog.bridge import source_case, design_job, bind_catalog, RECOGNITION_RULES

if hasattr(sys.stdin, 'reconfigure'):
    sys.stdin.reconfigure(encoding='utf-8')

def main():
    value = json.load(sys.stdin)
    action = value['action']
    if action == 'recognition-rules': result = {'rules':RECOGNITION_RULES}
    elif action == 'design-job': result = design_job(source_case(value['source']), value['request'])
    elif action == 'compile': result = bind_catalog(value['case'],value['catalog'])
    else: raise ValueError('Unknown UI catalog CPU action')
    print(json.dumps({'ok':True,'data':result},ensure_ascii=True))

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'ok':False,'error':str(error)},ensure_ascii=True)); sys.exit(1)
