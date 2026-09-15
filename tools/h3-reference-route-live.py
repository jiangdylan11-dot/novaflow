"""Run real local source-selection inference without launching video sampling."""
import importlib.util
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'particle-editor-desktop'))
spec = importlib.util.spec_from_file_location('service', root / 'particle-editor-desktop/prompt-assistant-service.py')
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)
assistant = service.PromptAssistant()
adapter = service.Qwen3VLAbliteratedAdapter(assistant.reverse_model_path(), max_new_tokens=350)
assistant._h3_reference_adapter = adapter
out = root / 'docs/h3-reference-general-20260915/route-probe'
out.mkdir(parents=True, exist_ok=True)
cases = {
    'background': '把参考视频的绿色背景改成紫色，金币外观和动作都保留',
    'speed': '让参考视频里的金币转得慢一倍，金币外观和背景保持原样',
    'coin': '把<Video 1>中旋转的金币样式换成<Picture 1>的样式，保持背景和运动轨迹',
    'color': '视频里人物的白色裙子改成红色，其他都别动',
    'outfit': '把视频里的人换成深蓝色牛仔外套和长裤，脸、头发、动作和背景保持原样',
    'ice': '把视频里的火焰变成冰的特效，保留运动轨迹和背景',
    'audio': '把视频的配乐换成<Audio 1>，画面不变',
}
try:
    for name, source in cases.items():
        selected_case = next((arg.split('=', 1)[1] for arg in sys.argv if arg.startswith('--case=')), None)
        if selected_case and name != selected_case:
            continue
        selected, controls = assistant.route_h3_reference_sources(source, '', 'Available resource labels: <Picture 1>; <Video 1>; <Audio 1>')
        value = {'request': source, 'sources': selected, 'editPolicy': controls}
        (out / (name + '.json')).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf8')
        print(json.dumps({'case': name, **value}, ensure_ascii=False), flush=True)
finally:
    adapter.unload()
