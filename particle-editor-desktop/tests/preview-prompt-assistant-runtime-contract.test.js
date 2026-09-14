const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const previewPath = path.join(root, "tools", "preview_runtime_server.py");
const source = fs.readFileSync(previewPath, "utf8");

assert.match(source, /creationflags=PROMPT_ASSISTANT_CREATION_FLAGS/);
assert.match(source, /NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_PATH/);
assert.match(source, /NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_TYPE/);
assert.match(source, /available = bool\(payload\.get\("enabled"\) or payload\.get\("reverseModelEnabled"\)\)/);
assert.match(source, /finally:\s+if reverse_model_only or \(minimax_h3_reverse and not h3_cleanup_done\):\s+_stop_prompt_assistant_process\(\)/);
assert.match(source, /timeout=180 if _is_prompt_assistant_minimax_h3_reverse\([\s\S]*?else 300,/);
assert.match(source, /raw_h3_reverse = _is_prompt_assistant_minimax_h3_reverse\([\s\S]*?try:\s+reverse_payload = _prompt_assistant_reverse_payload\(request\)[\s\S]*?finally:\s+if raw_h3_reverse:\s+with PROMPT_ASSISTANT_LOCK:\s+_stop_prompt_assistant_process\(\)/);
assert.match(source, /_stop_owned_novaflow_admin_server\(\)/);
assert.match(source, /def _admin_server_build_id\(\)/);
assert.match(source, /build identity mismatch/);
assert.match(source, /Get-CimInstance -ClassName Win32_Process/);
assert.match(source, /process identity is untrusted/);
assert.match(source, /PROMPT_ASSISTANT_H3_STAGE_LOG_PATH/);
assert.match(source, /def _inspect_prompt_assistant_runtime_queue\(base_url: str, timeout: float = 2\.5\)/);
assert.match(source, /if not isinstance\(running_queue, list\) or not isinstance\(pending_queue, list\):/);
assert.match(source, /if queue_state\.get\("state"\) == "busy":[\s\S]*?"runtime-generation-busy"/);
assert.match(source, /verified_queue_state = _inspect_prompt_assistant_runtime_queue\(base_url\)/);
assert.match(source, /message\.get\("type"\) == "startup-error"[\s\S]*?PromptAssistantStartupError/);
assert.match(source, /return_code == 73[\s\S]*?prompt-assistant-already-running/);
assert.match(source, /ordinary_art_prompt_patch and stop_result == "stop-timeout"[\s\S]*?prompt-assistant-stop-timeout/);
assert.match(
  source,
  /try:\s+message = _request_prompt_assistant\([\s\S]*?lock_already_held=ordinary_art_prompt_patch,[\s\S]*?deadline_monotonic=ordinary_art_inference_deadline,[\s\S]*?finally:\s+if ordinary_art_prompt_patch:\s+stop_result = _stop_prompt_assistant_process\(\)[\s\S]*?finally:\s+if ordinary_art_lock_acquired:\s+PROMPT_ASSISTANT_LOCK\.release\(\)/
);
assert.doesNotMatch(source, /print\([^\n]*(?:request_payload|dataUrl|sessionToken|accessToken)/);
assert.match(source, /payload\["surface"\] == "art"[\s\S]*?payload\["purpose"\] == "optimize"[\s\S]*?bool\(payload\["currentPrompt"\]\)[\s\S]*?requested_prompt_schema == "nf\.art\.prompt\.v1"/);

const pythonProbe = String.raw`
import importlib.util
import json
import pathlib
import queue
import sys
import tempfile
import threading

spec = importlib.util.spec_from_file_location("novaflow_preview_contract", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

assert module._is_novaflow_admin_health_payload({
    "ok": True, "service": "NovaFlow Admin Server", "status": "running"
})
assert not module._is_novaflow_admin_health_payload({
    "ok": True, "service": "another service", "status": "running"
})
assert module._is_prompt_assistant_static_image_reverse(
    "reverseImagePrompt", {"purpose": "static-image-reverse"}
)
assert not module._is_prompt_assistant_static_image_reverse(
    "reverseImagePrompt", {"purpose": "static_image_reverse"}
)
assert not module._is_prompt_assistant_static_image_reverse(
    "reverseImagePrompt", {"purpose": "storyboardReference"}
)
assert module._is_prompt_assistant_minimax_h3_reverse(
    "reverseImagePrompt", {"purpose": "minimax-h3-i2v-reverse"}
)
assert module._is_prompt_assistant_minimax_h3_reverse(
    "reverseImagePrompt", {"purpose": "minimax_h3_fl2v_reverse"}
)
assert not module._is_prompt_assistant_minimax_h3_reverse(
    "reverseImagePrompt", {"purpose": "static-image-reverse"}
)
assert module._prompt_assistant_h3_timeout_envelope() == {
    "errorCode": "h3-local-timeout",
    "failureCategory": "timeout",
    "retryable": True,
    "retryAttempted": False,
    "legacyFallbackSuppressed": True,
    "requestedVisualSchema": "nf.h3.visual.v1",
}

single_visual_v2 = module._prompt_assistant_reverse_payload({
    "purpose": "static-image-reverse",
    "visualSchema": "nf.visual.v2",
    "nsfw": True,
    "images": [{"dataUrl": "data:image/png;base64,ONE"}],
})
assert single_visual_v2["visualSchema"] == "nf.visual.v2"
assert single_visual_v2["nsfw"] is True

h3_sensitive = module._prompt_assistant_reverse_payload({
    "purpose": "minimax-h3-i2v-reverse",
    "visualSchema": "nf.h3.visual.v1",
    "userPrompt": "adult subject turns",
    "userRequirements": "preserve visible facts",
    "contentPolicy": {
        "sensitiveVisualAnalysis": True,
        "allSubjectsConfirmedAdult": False,
    },
    "nsfw": True,
    "images": [{"dataUrl": "data:image/png;base64,ONE"}],
})
assert h3_sensitive["visualSchema"] == "nf.h3.visual.v1"
assert h3_sensitive["contentPolicy"] == {
    "sensitiveVisualAnalysis": True,
    "allSubjectsConfirmedAdult": False,
}
assert "nsfw" not in h3_sensitive
assert h3_sensitive["userPrompt"] == "adult subject turns"
assert h3_sensitive["userRequirements"] == "preserve visible facts"

h3_unconfirmed = module._prompt_assistant_reverse_payload({
    "purpose": "minimax-h3-fl2v-reverse",
    "visualSchema": "nf.h3.visual.v1",
    "userPrompt": "",
    "userRequirements": "",
    "contentPolicy": {"sensitiveVisualAnalysis": True},
    "images": [
        {"dataUrl": "data:image/png;base64,ONE"},
        {"dataUrl": "data:image/png;base64,TWO"},
    ],
})
assert h3_unconfirmed["contentPolicy"] == {
    "sensitiveVisualAnalysis": True,
    "allSubjectsConfirmedAdult": False,
}

for invalid_h3 in (
    {
        "purpose": "minimax-h3-i2v-reverse",
        "userPrompt": "",
        "userRequirements": "",
    },
    {
        "purpose": "minimax-h3-i2v-reverse",
        "visualSchema": "nf.h3.visual.v0",
        "userPrompt": "",
        "userRequirements": "",
    },
    {
        "purpose": "minimax-h3-i2v-reverse",
        "visualSchema": "nf.h3.visual.v1",
        "userRequirements": "",
    },
    {
        "purpose": "minimax-h3-i2v-reverse",
        "visualSchema": "nf.h3.visual.v1",
        "userPrompt": "",
    },
):
    try:
        module._prompt_assistant_reverse_payload(invalid_h3)
        raise AssertionError("invalid H3 reverse bridge request must fail closed")
    except ValueError:
        pass

failure_metadata = module._prompt_assistant_failure_metadata({
    "error": "public error",
    "failure": {
        "errorCode": "v2-qwen3-fail-closed",
        "message": "视觉合同未通过",
        "retryable": True,
        "retryAttempted": True,
        "retryCount": 1,
        "reverseProvider": "qwen3_vl_abliterated_nf4",
        "providerFailureCode": "visual-contract-semantic-invalid",
        "legacyFallbackSuppressed": True,
        "requestedVisualSchema": "nf.visual.v2",
        "failureCategory": "semantic_contract",
        "applicationReason": "art-prompt-contract-invalid",
        "retentionReason": "named-block-preservation-failed",
        "rawOutput": "must-not-pass",
        "sensitive_visible_facts": ["must-not-pass"],
    },
})
assert failure_metadata == {
    "errorCode": "v2-qwen3-fail-closed",
    "message": "视觉合同未通过",
    "retryable": True,
    "retryAttempted": True,
    "retryCount": 1,
    "reverseProvider": "qwen3_vl_abliterated_nf4",
    "providerFailureCode": "visual-contract-semantic-invalid",
    "legacyFallbackSuppressed": True,
    "requestedVisualSchema": "nf.visual.v2",
    "failureCategory": "semantic_contract",
    "applicationReason": "art-prompt-contract-invalid",
    "retentionReason": "named-block-preservation-failed",
}

h3_deterministic_failure_metadata = module._prompt_assistant_failure_metadata({
    "ok": False,
    "error": "local H3 deterministic validation failed",
    "errorCode": "h3-local-deterministic-validation-failed",
    "failureCategory": "h3_contract_alignment",
    "failureClass": "audio-fidelity",
    "generationGate": "blocked",
    "requestedVisualSchema": "nf.h3.visual.v1",
    "retryable": False,
    "legacyFallbackSuppressed": True,
    "sensitivePromptBlocked": False,
})
assert h3_deterministic_failure_metadata == {
    "errorCode": "h3-local-deterministic-validation-failed",
    "failureCategory": "h3_contract_alignment",
    "failureClass": "audio-fidelity",
    "generationGate": "blocked",
    "requestedVisualSchema": "nf.h3.visual.v1",
    "retryable": False,
    "legacyFallbackSuppressed": True,
    "sensitivePromptBlocked": False,
}

for unchanged_payload in [
    module._prompt_assistant_reverse_payload({
        "purpose": "static-image-reverse",
        "visualSchema": "nf.visual.v2",
        "nsfw": True,
        "images": [
            {"dataUrl": "data:image/png;base64,ONE"},
            {"dataUrl": "data:image/png;base64,TWO"},
        ],
    }),
    module._prompt_assistant_reverse_payload({
        "purpose": "storyboardReference",
        "visualSchema": "nf.visual.v2",
        "nsfw": True,
        "images": [{"dataUrl": "data:image/png;base64,ONE"}],
    }),
]:
    assert "visualSchema" not in unchanged_payload
    assert "nsfw" not in unchanged_payload

structured_edit_payload = module._prompt_assistant_optimize_payload({
    "prompt": "existing full prompt",
    "currentPrompt": "existing full prompt",
    "requirements": "",
    "surface": "art",
    "purpose": "optimize",
    "promptSchema": "nf.art.prompt.v1",
})
assert structured_edit_payload["promptSchema"] == "nf.art.prompt.v1"
assert structured_edit_payload["requirements"] == ""

for isolated_optimize_payload in (
    {"prompt": "", "currentPrompt": "", "surface": "art", "purpose": "create", "promptSchema": "nf.art.prompt.v1"},
    {"prompt": "ui", "currentPrompt": "ui", "surface": "ui-design", "purpose": "optimize", "promptSchema": "nf.art.prompt.v1"},
    {"prompt": "animation", "currentPrompt": "animation", "surface": "animation", "purpose": "optimize", "promptSchema": "nf.art.prompt.v1"},
    {"prompt": "h3", "currentPrompt": "h3", "surface": "animation", "purpose": "minimax-h3-prompt-enhance", "promptSchema": "nf.art.prompt.v1"},
    {"prompt": "art", "currentPrompt": "", "surface": "art", "purpose": "optimize", "promptSchema": "nf.art.prompt.v1"},
    {"prompt": "art", "currentPrompt": "art", "surface": "art", "purpose": "optimize", "promptSchema": "nf.art.prompt.v1<script>"},
):
    assert "promptSchema" not in module._prompt_assistant_optimize_payload(isolated_optimize_payload)

with tempfile.TemporaryDirectory() as temp_dir:
    root = pathlib.Path(temp_dir) / "qwen3"
    root.mkdir()
    (root / "config.json").write_text(json.dumps({
        "architectures": ["Qwen3VLForConditionalGeneration"]
    }), encoding="utf-8")
    (root / "tokenizer_config.json").write_text("{}", encoding="utf-8")
    (root / "preprocessor_config.json").write_text("{}", encoding="utf-8")
    (root / "model-00001-of-00002.safetensors").write_bytes(b"one")
    (root / "model-00002-of-00002.safetensors").write_bytes(b"two")
    (root / "model.safetensors.index.json").write_text(json.dumps({
        "weight_map": {
            "a": "model-00001-of-00002.safetensors",
            "b": "model-00002-of-00002.safetensors"
        }
    }), encoding="utf-8")
    assert module._is_prompt_assistant_reverse_model_dir(root)

    old_read = module._read_prompt_assistant_runtime_config
    old_model = module._resolve_prompt_assistant_model_path
    old_reverse = module._resolve_prompt_assistant_reverse_model_path
    old_service = module._prompt_assistant_service_script
    old_python = module._resolve_prompt_assistant_python
    module._read_prompt_assistant_runtime_config = lambda: {}
    module._resolve_prompt_assistant_model_path = lambda _config: pathlib.Path(temp_dir) / "missing-legacy"
    module._resolve_prompt_assistant_reverse_model_path = lambda _config: root
    module._prompt_assistant_service_script = lambda: pathlib.Path(sys.argv[1])
    module._resolve_prompt_assistant_python = lambda _config: sys.executable
    config = module._prompt_assistant_config()
    assert config["ok"] is True
    assert config["enabled"] is False
    assert config["reverseModelEnabled"] is True
    assert config["reverseModelType"] == "qwen3_vl_8b_abliterated_nf4"
    module._read_prompt_assistant_runtime_config = old_read
    module._resolve_prompt_assistant_model_path = old_model
    module._resolve_prompt_assistant_reverse_model_path = old_reverse
    module._prompt_assistant_service_script = old_service
    module._resolve_prompt_assistant_python = old_python

    (root / "model-00002-of-00002.safetensors").unlink()
    assert not module._is_prompt_assistant_reverse_model_dir(root)

class FakeRuntimeResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status
    def read(self, _limit=None):
        return json.dumps(self.payload).encode("utf-8")
    def __enter__(self):
        return self
    def __exit__(self, *_args):
        return False

old_urlopen = module.urlopen
runtime_urls = []
module.urlopen = lambda request, timeout=2.5: (
    runtime_urls.append((request.full_url, request.get_method()))
    or FakeRuntimeResponse({"queue_running": [], "queue_pending": []})
)
idle_queue = module._inspect_prompt_assistant_runtime_queue("http://127.0.0.1:8188")
assert idle_queue == {
    "ok": True, "available": True, "state": "idle", "running": 0, "pending": 0,
}
assert runtime_urls == [("http://127.0.0.1:8188/queue", "GET")]
module.urlopen = lambda request, timeout=2.5: FakeRuntimeResponse({"queue_running": [[1]], "queue_pending": [[2]]})
busy_queue = module._inspect_prompt_assistant_runtime_queue("http://127.0.0.1:8188")
assert busy_queue["state"] == "busy" and busy_queue["running"] == 1 and busy_queue["pending"] == 1
module.urlopen = lambda request, timeout=2.5: FakeRuntimeResponse({"queue_running": [], "queue_pending": None})
invalid_queue = module._inspect_prompt_assistant_runtime_queue("http://127.0.0.1:8188")
assert invalid_queue["state"] == "indeterminate" and invalid_queue["ok"] is False
module.urlopen = lambda request, timeout=2.5: (_ for _ in ()).throw(module.URLError(ConnectionRefusedError(10061, "refused")))
offline_queue = module._inspect_prompt_assistant_runtime_queue("http://127.0.0.1:8188")
assert offline_queue["state"] == "no-listener" and offline_queue["noListener"] is True
module.urlopen = lambda request, timeout=2.5: (_ for _ in ()).throw(module.URLError(TimeoutError("timed out")))
timeout_queue = module._inspect_prompt_assistant_runtime_queue("http://127.0.0.1:8188")
assert timeout_queue["state"] == "indeterminate" and timeout_queue["noListener"] is False
module.urlopen = old_urlopen

old_inspect_runtime_queue = module._inspect_prompt_assistant_runtime_queue
old_request_runtime_free = module._request_prompt_assistant_runtime_free_memory
old_runtime_process_alive = module._prompt_assistant_runtime_process_alive
module._prompt_assistant_runtime_process_alive = lambda: False
free_calls = []
module._inspect_prompt_assistant_runtime_queue = lambda _base: {
    "ok": True, "available": True, "state": "busy", "running": 1, "pending": 0,
}
module._request_prompt_assistant_runtime_free_memory = lambda _base: free_calls.append(_base) or {"ok": True}
busy_handoff = module._prepare_prompt_assistant_resource_handoff("http://127.0.0.1:8188")
assert busy_handoff["errorCode"] == "runtime-generation-busy"
assert free_calls == []

idle_states = iter((
    {"ok": True, "available": True, "state": "idle", "running": 0, "pending": 0},
    {"ok": True, "available": True, "state": "idle", "running": 0, "pending": 0},
))
module._inspect_prompt_assistant_runtime_queue = lambda _base: next(idle_states)
idle_handoff = module._prepare_prompt_assistant_resource_handoff("http://127.0.0.1:8188")
assert idle_handoff["state"] == "runtime-memory-released" and idle_handoff["released"] is True
assert free_calls == ["http://127.0.0.1:8188"]

module._inspect_prompt_assistant_runtime_queue = lambda _base: {
    "ok": False, "available": False, "state": "no-listener", "noListener": True, "error": "refused",
}
offline_handoff = module._prepare_prompt_assistant_resource_handoff("http://127.0.0.1:8188")
assert offline_handoff["ok"] is True
assert offline_handoff["state"] == "runtime-unavailable-independent"
assert free_calls == ["http://127.0.0.1:8188"]

module._inspect_prompt_assistant_runtime_queue = lambda _base: {
    "ok": False, "available": False, "state": "indeterminate", "error": "timeout",
}
timeout_handoff = module._prepare_prompt_assistant_resource_handoff("http://127.0.0.1:8188")
assert timeout_handoff["errorCode"] == "runtime-queue-indeterminate"
module._prompt_assistant_runtime_process_alive = lambda: True
module._inspect_prompt_assistant_runtime_queue = lambda _base: {
    "ok": False, "available": False, "state": "no-listener", "noListener": True, "error": "refused",
}
alive_refused_handoff = module._prepare_prompt_assistant_resource_handoff("http://127.0.0.1:8188")
assert alive_refused_handoff["errorCode"] == "runtime-queue-indeterminate"
module._prompt_assistant_runtime_process_alive = lambda: False

post_release_states = iter((
    {"ok": True, "available": True, "state": "idle", "running": 0, "pending": 0},
    {"ok": True, "available": True, "state": "busy", "running": 0, "pending": 1},
))
module._inspect_prompt_assistant_runtime_queue = lambda _base: next(post_release_states)
post_release_handoff = module._prepare_prompt_assistant_resource_handoff("http://127.0.0.1:8188")
assert post_release_handoff["errorCode"] == "runtime-post-release-queue-not-idle"
assert len(free_calls) == 2
module._inspect_prompt_assistant_runtime_queue = old_inspect_runtime_queue
module._request_prompt_assistant_runtime_free_memory = old_request_runtime_free
module._prompt_assistant_runtime_process_alive = old_runtime_process_alive

class FakeStdin:
    def __init__(self): self.lines = []
    def write(self, value): self.lines.append(value)
    def flush(self): pass

class FakePromptProcess:
    def __init__(self): self.stdin = FakeStdin()
    def poll(self): return None

prompt_process = FakePromptProcess()
responses = queue.Queue()
ensure_modes = []
stops = []
module._prompt_assistant_config = lambda: {
    "serviceExists": True, "modelExists": True, "reverseModelEnabled": True,
    "enabled": True, "error": ""
}
module._ensure_prompt_assistant_process = lambda allow_reverse_only=False: (
    ensure_modes.append(bool(allow_reverse_only)) or prompt_process, responses
)
module._stop_prompt_assistant_process = lambda wait_timeout=5.0: stops.append(wait_timeout)
module.PROMPT_ASSISTANT_NEXT_REQUEST_ID = 1

responses.put(json.dumps({"id": 1, "ok": True, "data": {
    "reverseProvider": "qwen2_5_vl_fp8",
    "reverseFallbackReason": "qwen3-contract-invalid"
}}))
static_result = module._request_prompt_assistant(
    "reverseImagePrompt", {"purpose": "static-image-reverse", "images": []}, timeout=1
)
assert ensure_modes == [True]
assert len(stops) == 1
assert "qwen3-contract-invalid" in static_result["warning"]
assert json.loads(prompt_process.stdin.lines[-1])["purpose"] == "static-image-reverse"

responses.put(json.dumps({"id": 2, "ok": True, "data": {"prompt": "legacy"}}))
module._request_prompt_assistant(
    "reverseImagePrompt", {"purpose": "storyboardReference", "images": []}, timeout=1
)
assert ensure_modes == [True, False]
assert len(stops) == 1

responses.put(json.dumps({"id": 3, "ok": False, "error": "expected failure"}))
module._request_prompt_assistant(
    "reverseImagePrompt", {"purpose": "static-image-reverse", "images": []}, timeout=1
)
assert len(stops) == 2

real_time = module.time.time
ticks = iter([0.0, 0.0, 20.0])
module.time.time = lambda: next(ticks)
try:
    try:
        module._request_prompt_assistant(
            "reverseImagePrompt", {"purpose": "static-image-reverse", "images": []}, timeout=1
        )
        raise AssertionError("static timeout must fail")
    except TimeoutError:
        pass
finally:
    module.time.time = real_time
assert len(stops) == 4

timeout_process = FakePromptProcess()
fresh_process = FakePromptProcess()
timeout_responses = queue.Queue()
fresh_responses = queue.Queue()
active_prompt_process = {"value": timeout_process, "responses": timeout_responses}
spawned_prompt_processes = [timeout_process]
timed_out_prompt_processes = []

def ensure_fresh_prompt_process(allow_reverse_only=False):
    if active_prompt_process["value"] is None:
        active_prompt_process["value"] = fresh_process
        active_prompt_process["responses"] = fresh_responses
        spawned_prompt_processes.append(fresh_process)
    return active_prompt_process["value"], active_prompt_process["responses"]

def stop_active_prompt_process(wait_timeout=5.0):
    timed_out_prompt_processes.append(active_prompt_process["value"])
    active_prompt_process["value"] = None
    active_prompt_process["responses"] = None

module._ensure_prompt_assistant_process = ensure_fresh_prompt_process
module._stop_prompt_assistant_process = stop_active_prompt_process
module.PROMPT_ASSISTANT_NEXT_REQUEST_ID = 100
ticks = iter([0.0, 0.0, 20.0])
module.time.time = lambda: next(ticks)
try:
    try:
        module._request_prompt_assistant(
            "optimizePrompt", {"prompt": "timeout"}, timeout=1
        )
        raise AssertionError("ordinary optimize timeout must fail")
    except TimeoutError:
        pass
finally:
    module.time.time = real_time
assert timed_out_prompt_processes == [timeout_process]
assert active_prompt_process["value"] is None

fresh_responses.put(json.dumps({"id": 101, "ok": True, "data": {"prompt": "fresh"}}))
fresh_result = module._request_prompt_assistant(
    "optimizePrompt", {"prompt": "retry"}, timeout=1
)
assert fresh_result["data"]["prompt"] == "fresh"
assert spawned_prompt_processes == [timeout_process, fresh_process]
assert json.loads(timeout_process.stdin.lines[-1])["id"] == 100
assert json.loads(fresh_process.stdin.lines[-1])["id"] == 101

h3_process = FakePromptProcess()
h3_process.pid = 24680
h3_responses = queue.Queue()
h3_stops = []
h3_ensure_calls = []
module._ensure_prompt_assistant_process = lambda allow_reverse_only=False: (
    h3_ensure_calls.append(bool(allow_reverse_only)) or h3_process, h3_responses
)
module._stop_prompt_assistant_process = lambda wait_timeout=5.0: (
    h3_stops.append(wait_timeout) or "stopped"
)
module.PROMPT_ASSISTANT_NEXT_REQUEST_ID = 200
h3_responses.put(json.dumps({"id": 200, "ok": True, "data": {"prompt": "h3"}}))
h3_success = module._request_prompt_assistant(
    "reverseImagePrompt",
    {"purpose": "minimax-h3-i2v-reverse", "visualSchema": "nf.h3.visual.v1"},
    timeout=180,
)
assert h3_success["ok"] is True
assert h3_stops == [5.0]
assert h3_ensure_calls == [False]

ordinary_process = FakePromptProcess()
ordinary_responses = queue.Queue()
ordinary_stops = []
module._ensure_prompt_assistant_process = lambda allow_reverse_only=False: (
    ordinary_process, ordinary_responses
)
module._stop_prompt_assistant_process = lambda wait_timeout=5.0: (
    ordinary_stops.append(wait_timeout) or "stopped"
)
module.PROMPT_ASSISTANT_NEXT_REQUEST_ID = 300
ordinary_responses.put(json.dumps({"id": 300, "ok": True, "data": {"prompt": "ordinary"}}))
ordinary_success = module._request_prompt_assistant(
    "reverseImagePrompt", {"purpose": "storyboardReference"}, timeout=300
)
assert ordinary_success["ok"] is True
assert ordinary_stops == []

h3_timeout_process = FakePromptProcess()
h3_timeout_process.pid = 13579
h3_timeout_responses = queue.Queue()
h3_timeout_stops = []
h3_timeout_ensure_calls = []
module._ensure_prompt_assistant_process = lambda allow_reverse_only=False: (
    h3_timeout_ensure_calls.append(bool(allow_reverse_only)) or h3_timeout_process,
    h3_timeout_responses,
)
module._stop_prompt_assistant_process = lambda wait_timeout=5.0: (
    h3_timeout_stops.append(wait_timeout) or "stopped"
)
module.PROMPT_ASSISTANT_NEXT_REQUEST_ID = 400
ticks = iter([0.0, 0.0, 0.0, 0.0, 20.0, 20.0])
module.time.time = lambda: next(ticks)
try:
    h3_timeout = module._request_prompt_assistant(
        "reverseImagePrompt",
        {"purpose": "minimax-h3-fl2v-reverse", "visualSchema": "nf.h3.visual.v1"},
        timeout=10,
    )
finally:
    module.time.time = real_time
assert h3_timeout == {
    "ok": False,
    "error": "MiniMax H3 local reverse timed out",
    "errorCode": "h3-local-timeout",
    "failureCategory": "timeout",
    "retryable": True,
    "retryAttempted": False,
    "legacyFallbackSuppressed": True,
    "requestedVisualSchema": "nf.h3.visual.v1",
}
assert h3_timeout_stops == [5.0]
assert h3_timeout_ensure_calls == [False]
assert len(h3_timeout_process.stdin.lines) == 1

early_cleanup_stops = []
old_prompt_lock = module.PROMPT_ASSISTANT_LOCK
module.PROMPT_ASSISTANT_LOCK = threading.Lock()
module._stop_prompt_assistant_process = lambda wait_timeout=5.0: (
    early_cleanup_stops.append(wait_timeout) or "stopped"
)

def run_preview_reverse_request(payload):
    handler = object.__new__(module.PreviewRuntimeHandler)
    handler.path = module.PROMPT_ASSISTANT_PATH + "/reverse-image-prompt"
    handler._read_request_body = lambda: json.dumps(payload).encode("utf-8")
    responses = []
    handler._write_json_response = lambda status, body: responses.append((status, body))
    handler._handle_prompt_assistant()
    return responses

invalid_h3_responses = run_preview_reverse_request({
    "purpose": "minimax-h3-i2v-reverse",
    "userPrompt": "",
    "userRequirements": "",
})
assert invalid_h3_responses[-1][0] == 500
assert early_cleanup_stops == [5.0]

old_prompt_request = module._request_prompt_assistant
module._request_prompt_assistant = lambda command, payload, timeout=300: {
    "ok": False,
    "error": "local H3 deterministic validation failed",
    "errorCode": "h3-local-deterministic-validation-failed",
    "failureCategory": "h3_contract_alignment",
    "failureClass": "audio-fidelity",
    "generationGate": "blocked",
    "requestedVisualSchema": "nf.h3.visual.v1",
    "retryable": False,
    "legacyFallbackSuppressed": True,
    "sensitivePromptBlocked": False,
}
try:
    deterministic_failure_responses = run_preview_reverse_request({
        "purpose": "minimax-h3-i2v-reverse",
        "visualSchema": "nf.h3.visual.v1",
        "userPrompt": "",
        "userRequirements": "",
        "images": [{"dataUrl": "data:image/png;base64,ONE"}],
    })
finally:
    module._request_prompt_assistant = old_prompt_request
assert deterministic_failure_responses[0][0] == 500
deterministic_failure_body = deterministic_failure_responses[0][1]
assert deterministic_failure_body["ok"] is False
assert deterministic_failure_body["error"] == "local H3 deterministic validation failed"
assert deterministic_failure_body["preview"] is True
assert deterministic_failure_body["errorCode"] == "h3-local-deterministic-validation-failed"
assert deterministic_failure_body["requestedVisualSchema"] == "nf.h3.visual.v1"
assert deterministic_failure_body["failureCategory"] == "h3_contract_alignment"
assert deterministic_failure_body["failureClass"] == "audio-fidelity"
assert deterministic_failure_body["generationGate"] == "blocked"
assert deterministic_failure_body["retryable"] is False
assert deterministic_failure_body["legacyFallbackSuppressed"] is True
assert deterministic_failure_body["sensitivePromptBlocked"] is False
assert early_cleanup_stops == [5.0, 5.0]

old_prompt_config = module._prompt_assistant_config
module._prompt_assistant_config = lambda: (_ for _ in ()).throw(RuntimeError("config-failed"))
try:
    config_failure_responses = run_preview_reverse_request({
        "purpose": "minimax-h3-fl2v-reverse",
        "visualSchema": "nf.h3.visual.v1",
        "userPrompt": "",
        "userRequirements": "",
        "images": [],
    })
finally:
    module._prompt_assistant_config = old_prompt_config
assert config_failure_responses[-1][0] == 500
assert early_cleanup_stops == [5.0, 5.0, 5.0]
module.PROMPT_ASSISTANT_LOCK = old_prompt_lock

class FakeAdminProcess:
    def __init__(self): self.returncode = None; self.terminated = False
    def poll(self): return self.returncode
    def terminate(self): self.terminated = True; self.returncode = 0
    def kill(self): self.returncode = -9
    def wait(self, timeout=None): return self.returncode

stage_root = pathlib.Path(tempfile.mkdtemp(prefix="novaflow-h3-stage-"))
module.PROMPT_ASSISTANT_H3_STAGE_LOG_PATH = stage_root / "stage.jsonl"
module._persist_prompt_assistant_h3_stage(json.dumps({
    "event": "minimax_h3_visual_contract_bounded_stage",
    "command": "reverseImagePrompt",
    "mode": "I2VA",
    "visualSchema": "nf.h3.visual.v1",
    "stage": "sensitive-review",
    "outcome": "accepted",
    "reasonCode": "sensitive-facts-empty",
    "pictureIndex": 1,
    "attempt": 1,
    "rawOutput": "must-not-persist",
    "prompt": "must-not-persist",
    "dataUrl": "must-not-persist",
}))
stage_record = json.loads(module.PROMPT_ASSISTANT_H3_STAGE_LOG_PATH.read_text(encoding="utf-8"))
assert stage_record["stage"] == "sensitive-review"
assert "rawOutput" not in stage_record and "prompt" not in stage_record and "dataUrl" not in stage_record

stale_health = {
    "ok": True,
    "service": "NovaFlow Admin Server",
    "status": "running",
    "buildId": "old-build",
    "pid": 4321,
}
module._admin_server_build_id = lambda: "current-build"

real_admin_server_script = module._admin_server_script
windows_node = r"C:\Program Files\nodejs\node.exe"
windows_script = r"D:\AI_APP\NovaFlow\particle-editor-desktop\admin-server\server.js"
module._admin_server_script = lambda: windows_script
trusted, identity_error = module._windows_admin_process_identity_matches({
    "ProcessId": 4321,
    "ExecutablePath": windows_node,
    "CommandLine": f'"{windows_node}" "{windows_script}"',
}, 4321)
assert trusted is True and identity_error == ""
trusted, identity_error = module._windows_admin_process_identity_matches({
    "ProcessId": 4321,
    "ExecutablePath": windows_node,
    "CommandLine": f'"{windows_node}" "D:\\Other\\server.js"',
}, 4321)
assert trusted is False and "script path does not match" in identity_error
trusted, identity_error = module._windows_admin_process_identity_matches({
    "ProcessId": 4321,
    "ExecutablePath": windows_node,
    "CommandLine": f'"{windows_node}" "server.js"',
}, 4321)
assert trusted is False and "absolute executable and script paths" in identity_error
module._admin_server_script = real_admin_server_script

kill_calls = []
identity_checks = []
module.os.kill = lambda pid, sig: kill_calls.append((pid, sig))
module._admin_server_process_identity_trusted = lambda pid: (
    identity_checks.append(pid) or (False, "identity verifier must not run for the current build")
)
module._read_novaflow_admin_health_payload = lambda timeout=1.2: ({
    "ok": True,
    "service": "NovaFlow Admin Server",
    "status": "running",
    "buildId": "current-build",
    "pid": 9999,
}, "")
state = module._ensure_novaflow_admin_server("127.0.0.1", 4783)
assert state["reused"] is True and state["buildId"] == "current-build"
assert identity_checks == [] and kill_calls == []

module._read_novaflow_admin_health_payload = lambda timeout=1.2: (stale_health, "")
module._admin_server_process_identity_trusted = lambda pid: (
    False,
    "process script path does not match the current NovaFlow admin server",
)
try:
    module._ensure_novaflow_admin_server("127.0.0.1", 4783)
    raise AssertionError("forged stale PID must be rejected")
except RuntimeError as error:
    assert "127.0.0.1:4761 is occupied" in str(error)
    assert "process identity is untrusted" in str(error)
assert kill_calls == []

admin_process = FakeAdminProcess()
spawn_options = {}
module._read_novaflow_admin_health_payload = lambda timeout=1.2: (stale_health, "")
module._admin_server_process_identity_trusted = lambda pid: (pid == 4321, "")
module._admin_server_port_is_open = lambda timeout=0.35: False
module._admin_server_node_executable = lambda: sys.executable
module._wait_for_novaflow_admin_server = lambda proc, timeout=7.0: (True, "")
module.subprocess.Popen = lambda *args, **kwargs: (spawn_options.update(kwargs) or admin_process)
state = module._ensure_novaflow_admin_server("127.0.0.1", 4783)
assert state["owned"] is True and module.ADMIN_SERVER_PROCESS is admin_process
assert state["reused"] is False
assert kill_calls == [(4321, module.signal.SIGTERM)]
assert spawn_options["creationflags"] == module.ADMIN_SERVER_CREATION_FLAGS
assert spawn_options["env"]["NOVAFLOW_ADMIN_SERVER_REQUEST_LOGS"] == "0"
module._stop_owned_novaflow_admin_server()
assert admin_process.terminated is True and module.ADMIN_SERVER_PROCESS is None

print("python preview runtime contract: passed")
`;

const pythonCandidates = [process.env.PYTHON, "python", "py"].filter(Boolean);
let result = null;
for (const candidate of pythonCandidates) {
  const args = candidate === "py" ? ["-3", "-B", "-c", pythonProbe, previewPath] : ["-B", "-c", pythonProbe, previewPath];
  const attempt = spawnSync(candidate, args, { cwd: root, encoding: "utf8", timeout: 30_000 });
  if (!attempt.error || attempt.error.code !== "ENOENT") {
    result = attempt;
    break;
  }
}
assert.ok(result, "Python is required for the executable preview contract");
assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
assert.match(result.stdout, /python preview runtime contract: passed/);

console.log("preview-prompt-assistant-runtime-contract: passed");
