"""Observe a neutral image, remove a field, then test real same-image recovery."""
import importlib.util
import json
from pathlib import Path
import re
import sys
import time

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'particle-editor-desktop'))
spec = importlib.util.spec_from_file_location('h3_slot_live_service', root / 'particle-editor-desktop/prompt-assistant-service.py')
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)
import numpy as np
import torch
from PIL import Image

out = root / 'docs/h3-final-three-validation'
out.mkdir(parents=True, exist_ok=True)
tensor = torch.from_numpy(np.array(Image.open(root / 'docs/wan-vs-smoothmix-wash-validation/cyber-portrait/source.png').convert('RGB'))).float().div(255).unsqueeze(0)
adapter = service.Qwen3VLAbliteratedAdapter(service.PromptAssistant().reverse_model_path(), max_side=768, max_new_tokens=160)
started = time.monotonic()
calls = 0
def observe(prompt):
    global calls
    calls += 1
    text = adapter.generate(prompt, tensor, unload_after=False, system_text=service.MINIMAX_H3_BOUNDED_VISUAL_SYSTEM_TEXT, max_new_tokens=160, stop_strings=(service.MINIMAX_H3_RICH_VISUAL_STOP_MARKER,))
    (out / f'slot-recovery-call-{calls}.txt').write_text(text, encoding='utf-8')
    return text
try:
    initial = observe(service.minimax_h3_faithful_rich_primary_instruction())
    # Deliberately simulate truncation: omit C and leave no terminator.
    partial = re.sub(r'[|｜\r\n]+C\s*[:：][^|｜\r\n]*', '', initial).split(service.MINIMAX_H3_RICH_VISUAL_STOP_MARKER)[0].strip()
    (out / 'slot-recovery-injected.txt').write_text(partial, encoding='utf-8')
    result = service.minimax_h3_repair_bounded_visual_slots(partial, observe)
    assert calls == 2, 'one initial observation and exactly one real repair required'
    assert '[拍摄参数]' in result
    (out / 'slot-recovery-output.txt').write_text(result, encoding='utf-8')
    report = {'ok': True, 'calls': calls, 'elapsedSeconds': round(time.monotonic()-started, 2), 'faultInjected': True, 'sameImage': True}
    (out / 'slot-recovery-result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))
finally:
    adapter.unload()
