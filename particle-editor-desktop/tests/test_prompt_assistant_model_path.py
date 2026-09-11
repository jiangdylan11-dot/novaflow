import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "particle-editor-desktop"))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SERVICE = load("model_path_service", ROOT / "particle-editor-desktop/prompt-assistant-service.py")
PREVIEW = load("model_path_preview", ROOT / "tools/preview_runtime_server.py")


class ModelPathTest(unittest.TestCase):
    def test_service_reads_persisted_path_and_preserves_environment_override(self):
        assistant = SERVICE.PromptAssistant()
        assistant.read_runtime_config = lambda: {"promptAssistantReverseModelPath": "configured/model"}
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(assistant.reverse_model_path(), Path("configured/model"))
            os.environ["NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_PATH"] = "override/model"
            self.assertEqual(assistant.reverse_model_path(), Path("override/model"))

    def test_preview_resolves_the_same_path_with_legacy_fallback(self):
        config = {"promptAssistantReverseModelPath": "configured/model", "modelsPath": "shared/models"}
        with patch.dict(os.environ, {}, clear=True), patch.object(
            PREVIEW, "_is_prompt_assistant_reverse_model_dir", side_effect=lambda p: p == Path("configured/model")
        ):
            self.assertEqual(PREVIEW._resolve_prompt_assistant_reverse_model_path(config), Path("configured/model"))
        with patch.dict(os.environ, {}, clear=True), patch.object(
            PREVIEW, "_is_prompt_assistant_reverse_model_dir", side_effect=lambda p: p == PREVIEW.PROMPT_ASSISTANT_REVERSE_DEFAULT_MODEL_PATH
        ):
            self.assertEqual(PREVIEW._resolve_prompt_assistant_reverse_model_path(config), PREVIEW.PROMPT_ASSISTANT_REVERSE_DEFAULT_MODEL_PATH)


if __name__ == "__main__":
    unittest.main()
