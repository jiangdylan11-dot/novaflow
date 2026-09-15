"""Run the real local prompt assistant and save its returned prompt/profile."""
import importlib.util
import json
from pathlib import Path
import sys
import time

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'particle-editor-desktop'))
spec = importlib.util.spec_from_file_location('h3_live_service', root / 'particle-editor-desktop/prompt-assistant-service.py')
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)
assistant = service.PromptAssistant()
payload = {
    'purpose': 'minimax-h3-prompt-enhance', 'h3Mode': 'I2VA', 'durationSeconds': 10,
    'currentPrompt': '以 <Picture 1> 为起始图，16:9，10秒。紫眸赛博仿生女性，黑色编发、湿润反光、未来实验室。她从低头抬眼看向镜头，紫色眼光渐亮；开始说话时头部缓慢转正，肩颈机械装置轻微联动。抬起右手从胸前缓慢经过，然后放下，身体轻微前倾。镜头缓慢拉近后轻微后撤，最后目光锁定镜头。面部、身份和口型稳定，线缆轻微可控摆动，不增加随机饰件或突然切远景。\n(S1)："系统自检完成。动力核心已上线，下一条指令——可以直接下达。"',
    'requirements': '把动作和说话分成递进时间段，保留原台词和同一人物身份。',
}
out = root / 'docs/h3-five-section-validation'
out.mkdir(parents=True, exist_ok=True)
(out / 'input.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
started = time.monotonic()
generate = assistant.generate
attempt = 0
def capture(*args, **kwargs):
    global attempt
    attempt += 1
    text = generate(*args, **kwargs)
    (out / f'local-attempt-{attempt}.txt').write_text(text, encoding='utf-8')
    return text
assistant.generate = capture
try:
    result = assistant.optimize_prompt(payload)
    (out / 'local-output.txt').write_text(result['positivePrompt'], encoding='utf-8')
    (out / 'local-result.json').write_text(json.dumps({'elapsed': time.monotonic()-started, 'profile': assistant.last_generate_profile, **result}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'ok': True, 'elapsed': time.monotonic()-started, 'chars': len(result['positivePrompt'])}))
finally:
    assistant.clip = None
