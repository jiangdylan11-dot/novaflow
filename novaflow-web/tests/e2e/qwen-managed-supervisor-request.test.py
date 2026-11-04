import importlib.util
import pathlib
import sys
import threading
import unittest

SRC = pathlib.Path(__file__).resolve().parents[2] / 'worker' / 'src'
sys.path.insert(0, str(SRC))
spec = importlib.util.spec_from_file_location('qwen_supervisor_test', SRC / 'gemma-cpu-supervisor.py')
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)


class ManagedRequestTest(unittest.TestCase):
    def setUp(self):
        self.request = {'parentPid': 1, 'port': 20000, 'exe': 'exe', 'model': 'model',
                        'projector': 'projector', 'apiKey': 'a' * 64,
                        'modelId': 'qwen3.5-9b-heretic'}

    def test_legacy_explicit_runner_is_still_accepted(self):
        supervisor.validate_request(self.request)

    def test_absolute_managed_qwen_path_is_accepted(self):
        supervisor.validate_request({**self.request, 'managedComponentRoot': str(pathlib.Path.cwd())})

    def test_relative_empty_and_non_string_managed_paths_are_rejected(self):
        for value in ('', 'relative/path', None, 4):
            with self.subTest(value=value), self.assertRaises(ValueError):
                supervisor.validate_request({**self.request, 'managedComponentRoot': value})

    def test_managed_path_cannot_be_used_for_other_models(self):
        with self.assertRaises(ValueError):
            supervisor.validate_request({**self.request, 'modelId': 'gemma-4-12b-it',
                                         'managedComponentRoot': str(pathlib.Path.cwd())})

    def test_unexpected_fields_are_still_rejected(self):
        with self.assertRaises(ValueError):
            supervisor.validate_request({**self.request, 'unexpected': True})

    def test_forged_managed_directory_fails_integrity(self):
        with self.assertRaises(Exception):
            supervisor.verify_managed_cpu_component(str(pathlib.Path.cwd()),
                                                    str(pathlib.Path.cwd() / 'llama-server.exe'),
                                                    threading.Event())


if __name__ == '__main__':
    unittest.main()
