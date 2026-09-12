"""CPU-only node contract tests, with no real model, CUDA kernel, or generation."""
import copy
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('h3_attention', Path(__file__).parent / 'nodes/novaflow_h3_attention/__init__.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Model:
    def __init__(self, family='minimax_h3'):
        self.model = SimpleNamespace(model_config=SimpleNamespace(unet_config={'image_model': family}))
        self.model_options = {'transformer_options': {}}

    def clone(self):
        clone = copy.copy(self)
        clone.model_options = copy.deepcopy(self.model_options)
        return clone

class AttentionTests(unittest.TestCase):
    def modules(self, available=True):
        def sage(*args, **kwargs):
            return (args, kwargs)
        attention = SimpleNamespace(get_attention_function=lambda *args: sage if available else None)
        return {'comfy.ldm.modules': SimpleNamespace(attention=attention), 'sageattention': SimpleNamespace(), 'triton': SimpleNamespace()}

    def test_isolated_override_preserves_model_and_forwards_wrapper_guard(self):
        source = Model()
        with patch.dict(sys.modules, self.modules()):
            updated, = module.NovaFlowH3SageAttention().apply(source)
        self.assertIs(updated.model, source.model)
        self.assertNotIn('optimized_attention_override', source.model_options['transformer_options'])
        override = updated.model_options['transformer_options']['optimized_attention_override']
        args, kwargs = override(None, 'q', 'k', 'v', 56, _inside_attn_wrapper=True, skip_reshape=True)
        self.assertEqual(args, ('q', 'k', 'v', 56))
        self.assertTrue(kwargs['_inside_attn_wrapper'])

    def test_rejects_wrong_model_conflicting_override_and_unavailable_backend(self):
        with patch.dict(sys.modules, self.modules()):
            with self.assertRaises(ValueError): module.NovaFlowH3SageAttention().apply(Model('wan'))
            source = Model()
            source.model_options['transformer_options']['optimized_attention_override'] = lambda: None
            with self.assertRaises(ValueError): module.NovaFlowH3SageAttention().apply(source)
        with patch.dict(sys.modules, self.modules(False)):
            with self.assertRaises(RuntimeError): module.NovaFlowH3SageAttention().apply(Model())

if __name__ == '__main__':
    unittest.main()
