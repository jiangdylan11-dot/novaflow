"""Subprocess fixture: real adapter and framing, no model or network."""
import base64
import io
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'particle-editor-desktop'))
from PIL import Image
from prompt_assistant.flash_adapter import FlashAdapter, begin_flash_request, end_flash_request

def emit(data):
    print(json.dumps(data, ensure_ascii=False), flush=True)

emit({'type': 'ready'})
for line in sys.stdin:
    request = json.loads(line)
    if request.get('command') == 'shutdown':
        break
    token = begin_flash_request(request['id'])
    try:
        parts = []
        if request.get('images'):
            data_url = request['images'][0]['dataUrl']
            parts.append(Image.open(io.BytesIO(base64.b64decode(data_url.split(',', 1)[1]))).copy())
        parts.append(request.get('requirements') or '分析素材')
        style = FlashAdapter(max_new_tokens=600).generate_parts(parts, system_text='用中文回答')
        command = request.get('command')
        result = {'model': os.environ['NOVAFLOW_FLASH_MODEL_ID']}
        if command == 'describeArtStyle':
            result['style'] = style
        elif command in ('optimizePrompt', 'reverseImagePrompt'):
            result.update(positivePrompt=style, negativePrompt='')
        else:
            raise ValueError('unsupported fixture business command')
        emit({'id': request['id'], 'ok': True, 'data': result})
    except Exception as exc:
        emit({'id': request['id'], 'ok': False, 'error': str(exc)})
    finally:
        end_flash_request(token)
