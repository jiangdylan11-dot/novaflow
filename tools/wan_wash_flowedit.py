"""Compatibility import for the canonical experimental Comfy node sampler."""
import importlib.util
from pathlib import Path

SAMPLER_PATH = Path(__file__).resolve().parents[1] / 'particle-editor-desktop/main/wan-wash-node/sampler.py'
_spec = importlib.util.spec_from_file_location('novaflow_wan_wash_sampler', SAMPLER_PATH)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
integrate = _module.integrate
sample = _module.sample
