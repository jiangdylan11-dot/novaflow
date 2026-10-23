import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np
import torch


class BF16GGUFLoaderTest(unittest.TestCase):
    def setUp(self):
        self.native = Mock(return_value='native-model')
        sd = types.ModuleType('comfy.sd')
        sd.load_diffusion_model_state_dict = self.native
        comfy = types.ModuleType('comfy')
        comfy.sd = sd
        self.folder = types.SimpleNamespace(get_full_path_or_raise=Mock(return_value='model.gguf'))
        self.nodes = types.SimpleNamespace(NODE_CLASS_MAPPINGS={})
        self.reader = types.SimpleNamespace(tensors=[], get_field=lambda _: None)
        self.gguf = types.SimpleNamespace(GGUFReader=Mock(return_value=self.reader), GGMLQuantizationType=types.SimpleNamespace(BF16='BF16'))
        self.modules = patch.dict(sys.modules, {'comfy': comfy, 'comfy.sd': sd, 'folder_paths': self.folder, 'nodes': self.nodes, 'gguf': self.gguf})
        self.modules.start()
        source = Path(__file__).resolve().parents[2] / 'worker/src/comfy/qwen21-bf16-loader.py'
        spec = importlib.util.spec_from_file_location('bf16_test_node', source)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.loader = self.module.NovaFlowGGUFBF16Loader()

    def tearDown(self):
        self.modules.stop()

    def test_bf16_storage_and_original_shape_are_preserved(self):
        bits = np.array([0x3f80, 0xbf80, 0x4000, 0x0000], dtype=np.uint16)
        data = bits.view(np.uint8)
        self.reader.tensors = [types.SimpleNamespace(name='weight', tensor_type='BF16', shape=(4,), data=data)]
        self.reader.get_field = lambda name: types.SimpleNamespace(parts=[np.array([2]), np.array([2])], data=[0, 1])
        self.assertEqual(self.loader.load_model('standard-bf16.gguf'), ('native-model',))
        state = self.native.call_args.args[0]
        tensor = state['weight']
        self.assertEqual(tensor.dtype, torch.bfloat16)
        self.assertEqual(tuple(tensor.shape), (2, 2))
        self.assertEqual(tensor.data_ptr(), data.ctypes.data)
        self.assertEqual(tensor.float().tolist(), [[1.0, -1.0], [2.0, 0.0]])
        self.assertEqual(self.native.call_args.kwargs['model_options'], {'dtype': torch.bfloat16})

    def test_quantized_or_invalid_tensors_never_reach_native_loader(self):
        for kind, size, error in [('Q8_0', 8, 'entirely BF16'), ('BF16', 7, 'Invalid BF16 tensor size')]:
            with self.subTest(kind=kind):
                self.reader.tensors = [types.SimpleNamespace(name='weight', tensor_type=kind, shape=(2, 2), data=np.zeros(size, dtype=np.uint8))]
                with self.assertRaisesRegex(ValueError, error):
                    self.loader.load_model('bad.gguf')
                self.native.assert_not_called()

    def test_missing_extension_is_safe_and_present_extension_supplies_file_choices(self):
        self.assertEqual(self.loader.INPUT_TYPES(), {'required': {'unet_name': ([],)}})
        options = {'required': {'unet_name': (['standard-bf16.gguf', 'turbo-bf16.gguf'],)}}
        self.nodes.NODE_CLASS_MAPPINGS['UnetLoaderGGUF'] = types.SimpleNamespace(INPUT_TYPES=lambda: options)
        self.assertEqual(self.loader.INPUT_TYPES(), options)

    def test_unsupported_architecture_fails_explicitly(self):
        self.native.return_value = None
        with self.assertRaisesRegex(ValueError, 'Unsupported BF16 GGUF'):
            self.loader.load_model('unknown.gguf')


if __name__ == '__main__':
    unittest.main()
