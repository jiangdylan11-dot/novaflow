import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[3]/"particle-editor-desktop"))
from prompt_assistant.pe_adapter import ComfyPEAdapter, PE_MODEL

class PEContractTests(unittest.TestCase):
    def test_text_request_uses_only_pe_and_preserves_system_protocol(self):
        adapter=ComfyPEAdapter("missing")
        calls=[]
        def request(path,payload=None):
            calls.append((path,payload))
            if path=="/queue": return {"queue_running":[],"queue_pending":[]}
            if path=="/prompt": return {"prompt_id":"own"}
            if path=="/history/own": return {"own":{"status":{"status_str":"success"},"outputs":{"4":{"text":["</think>\n{\"answer\":\"ok\"}"]}}}}
            self.fail(path)
        adapter._json=request
        result=adapter.generate_parts(["request"],system_text="exact output contract",max_new_tokens=512)
        graph=next(p["prompt"] for path,p in calls if path=="/prompt")
        self.assertEqual(graph["1"]["inputs"]["clip_name"],PE_MODEL)
        self.assertEqual(sum(n["class_type"]=="CLIPLoader" for n in graph.values()),1)
        self.assertIn("exact output contract",graph["3"]["inputs"]["prompt"])
        self.assertEqual(result,'{"answer":"ok"}')
    def test_busy_queue_never_submits_or_loads_another_model(self):
        adapter=ComfyPEAdapter("missing")
        adapter._json=lambda *a: {"queue_running":[[0,"other"]],"queue_pending":[]}
        with self.assertRaisesRegex(Exception,"pe-runtime-busy"):
            adapter.generate_parts(["request"])
    def test_missing_pe_never_builds_nf4_cache(self):
        adapter=ComfyPEAdapter("missing")
        with self.assertRaisesRegex(Exception,"pe-model-missing"):
            adapter.prepare_prequantized_cache()
    def test_failed_task_does_not_retry_a_different_model(self):
        adapter=ComfyPEAdapter("missing")
        calls=[]
        def request(path,payload=None):
            calls.append(path)
            if path=="/queue": return {"queue_running":[],"queue_pending":[]}
            if path=="/prompt": return {"prompt_id":"own"}
            return {"own":{"status":{"status_str":"error"}}}
        adapter._json=request
        with self.assertRaisesRegex(Exception,"pe-inference-failed"):
            adapter.generate_parts(["request"])
        self.assertEqual(calls.count("/prompt"),1)

if __name__=="__main__": unittest.main()
