"""Emit the existing Qwen Image policy for the companion's fixed art modes."""
import importlib.util
import json
from pathlib import Path

path = Path(__file__).resolve().parents[2] / 'particle-editor-desktop' / 'prompt_assistant' / 'qwen21_prompt_policy.py'
spec = importlib.util.spec_from_file_location('foart_qwen21_policy', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(json.dumps({mode: module.policy_for({'targetEngine': 'qwen-2.1', 'surface': 'art',
                                          'qwenPromptMode': mode})
                  for mode in ('txt2img', 'img2img')}, ensure_ascii=True, sort_keys=True))
