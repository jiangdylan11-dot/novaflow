from __future__ import annotations

import argparse
import base64
import contextlib
import hashlib
import ipaddress
import json
import math
import mimetypes
import ntpath
import os
import queue
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlsplit
from urllib.request import Request, urlopen


DEFAULT_BASE_URL = "http://127.0.0.1:8188"
PROXY_PREFIX = "/__runtime_proxy"
HEALTH_PATH = "/__runtime_health"
MOUSE_POSITION_PATH = "/__mouse_position"
AIFX_PIPELINE_PATH = "/__aifx_spritesheet_conditioned_regen"
PROMPT_ASSISTANT_PATH = "/__prompt_assistant"
AI_SEQUENCE_LORA_PATH = "/__ai_sequence_lora"
AI_SEQUENCE_LORA_BRIDGE = Path(__file__).resolve().parent / "ai_sequence_lora_preview_bridge.js"
AI_SEQUENCE_LORA_MAX_BODY_BYTES = 64 * 1024
AI_SEQUENCE_LORA_TIMEOUT_SEC = 30
AI_SEQUENCE_LORA_CREATION_FLAGS = (
    getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
)
AI_SEQUENCE_H3_OUTPUT_PATH = "/__ai_sequence_h3_output"
AI_SEQUENCE_H3_OUTPUT_PUBLISHER = (
    Path(__file__).resolve().parents[1]
    / "particle-editor-desktop"
    / "main"
    / "minimax-h3-output-publisher.js"
)
AI_SEQUENCE_H3_RUNTIME_JSON = Path(r"C:\ProgramData\NovaFlow\AI-Runtime-H3\runtime.json")
AI_SEQUENCE_H3_WAREHOUSE_DIR = Path(tempfile.gettempdir()) / "NovaFlow" / "preview-ai-sequence-warehouse"
AI_SEQUENCE_H3_OUTPUT_ACTIONS = frozenset({"publish", "list"})
AI_SEQUENCE_H3_OUTPUT_PUBLISH_FIELDS = frozenset({
    "promptId",
    "filename",
    "subfolder",
    "type",
    "mediaDurationSec",
    "generationElapsedSec",
})
AI_SEQUENCE_H3_OUTPUT_TIMING_LIMITS = {
    "mediaDurationSec": (0.0, 60.0, False),
    "generationElapsedSec": (0.0, 86400.0, True),
}
AI_SEQUENCE_H3_OUTPUT_MAX_BODY_BYTES = 64 * 1024
AI_SEQUENCE_H3_OUTPUT_TIMEOUT_SEC = 30
AI_SEQUENCE_H3_OUTPUT_CREATION_FLAGS = (
    getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
)
AI_SEQUENCE_H3_OUTPUT_NODE_RUNNER = r"""
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const request = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  const publisherModule = require(process.env.NOVAFLOW_H3_OUTPUT_PUBLISHER);
  const { readMiniMaxH3RuntimeConfig } = require(path.join(
    path.dirname(process.env.NOVAFLOW_H3_OUTPUT_PUBLISHER),
    "minimax-h3-runtime-lifecycle.js",
  ));
  const createPublisher = publisherModule.createMiniMaxH3OutputPublisher;
  if (typeof createPublisher !== "function") throw new Error("h3_output_publisher_factory_unavailable");
  const publisher = createPublisher({
    readRuntimeConfig: () => readMiniMaxH3RuntimeConfig({
      runtimeRoot: path.dirname(process.env.NOVAFLOW_H3_RUNTIME_JSON),
    }),
    getWarehouseDir: () => process.env.NOVAFLOW_H3_WAREHOUSE_DIR,
  });
  let result;
  if (request.action === "publish") {
    const item = await publisher.publish(request.payload || {});
    result = { ok: Boolean(item), item: item || null };
  } else if (request.action === "list") {
    const items = await publisher.list();
    result = { ok: true, items: Array.isArray(items) ? items : [] };
  } else if (request.action === "resolve") {
    const resolvedPath = await publisher.resolve(request.id);
    result = { ok: Boolean(resolvedPath), path: resolvedPath || "" };
  }
  else throw new Error("unsupported_action");
  process.stdout.write(JSON.stringify(result || {}));
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error && error.message || error) }));
  process.exitCode = 1;
});
"""


def _normalize_ai_sequence_h3_output_publish_payload(payload: object) -> tuple[dict | None, str]:
    if not isinstance(payload, dict):
        return None, "invalid_publish_payload"
    if set(payload) - AI_SEQUENCE_H3_OUTPUT_PUBLISH_FIELDS:
        return None, "unsupported_publish_payload_fields"

    normalized = {
        key: payload.get(key)
        for key in AI_SEQUENCE_H3_OUTPUT_PUBLISH_FIELDS
        if key in payload
    }
    for key, (minimum, maximum, minimum_inclusive) in AI_SEQUENCE_H3_OUTPUT_TIMING_LIMITS.items():
        if key not in normalized:
            continue
        value = normalized[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None, f"invalid_{key}"
        try:
            numeric = float(value)
        except (OverflowError, TypeError, ValueError):
            return None, f"invalid_{key}"
        if not math.isfinite(numeric):
            return None, f"invalid_{key}"
        if (numeric < minimum if minimum_inclusive else numeric <= minimum) or numeric > maximum:
            return None, f"invalid_{key}"

    return normalized, ""


PROMPT_ASSISTANT_CREATION_FLAGS = (
    getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
)
ADMIN_SERVER_CREATION_FLAGS = (
    getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
)
AIFX_PIPELINE = "AIFX_SPRITESHEET_CONDITIONED_REGEN_PIPELINE"
AIFX_REQUEST_ROOT = Path(__file__).resolve().parents[1] / "debug-output" / "aifx-spritesheet-product-requests"
DEBUG_LOG_PATH = Path(__file__).resolve().parents[1] / "logs" / "debug.log"
AIFX_LOCK = threading.Lock()
PROMPT_ASSISTANT_LOCK = threading.Lock()
PROMPT_ASSISTANT_PROCESS = None
PROMPT_ASSISTANT_STDOUT_QUEUE = None
PROMPT_ASSISTANT_STDERR_TAIL: list[str] = []
PROMPT_ASSISTANT_STDERR_LOCK = threading.Lock()
PROMPT_ASSISTANT_NEXT_REQUEST_ID = 1
PROMPT_ASSISTANT_LAST_WARNING = ""
PROMPT_ASSISTANT_MODEL_TYPE = "qwen2_5_vl_7b_fp8"
PROMPT_ASSISTANT_MODEL_NAME = "qwen_2.5_vl_7b_fp8_scaled.safetensors"
PROMPT_ASSISTANT_DEFAULT_MODEL_PATH = Path(r"E:\BaiduNetdiskDownload\qwen_2.5_vl_7b_fp8_scaled.safetensors")
PROMPT_ASSISTANT_REVERSE_MODEL_TYPE = "qwen3_vl_8b_abliterated_nf4"
PROMPT_ASSISTANT_REVERSE_MODEL_DIR_NAME = "Huihui-Qwen3-VL-8B-Instruct-Abliterated"
PROMPT_ASSISTANT_REVERSE_DEFAULT_MODEL_PATH = (
    Path(r"E:\BaiduNetdiskDownload\prompt_generator") / PROMPT_ASSISTANT_REVERSE_MODEL_DIR_NAME
)
PROMPT_ASSISTANT_DEFAULT_RUNTIME_JSON = Path(r"C:\ProgramData\NovaFlow\AI-Runtime\runtime.json")


class PromptAssistantStartupError(RuntimeError):
    def __init__(self, message: str, error_code: str = "prompt-assistant-startup-error") -> None:
        super().__init__(message)
        self.error_code = re.sub(r"[^a-zA-Z0-9_.:-]+", "-", str(error_code or "")).strip("-")[:80]
        self.retryable = True
ADMIN_SERVER_HOST = "127.0.0.1"
ADMIN_SERVER_PORT = 4761
ADMIN_SERVER_HEALTH_URL = f"http://{ADMIN_SERVER_HOST}:{ADMIN_SERVER_PORT}/health"
ADMIN_SERVER_PROCESS = None
ADMIN_SERVER_PROCESS_LOCK = threading.Lock()
PROMPT_ASSISTANT_H3_STAGE_LOG_PATH = (
    Path(tempfile.gettempdir()) / "NovaFlow" / "preview-h3-stage.jsonl"
)
PROMPT_ASSISTANT_H3_STAGE_LOG_LOCK = threading.Lock()
PROMPT_ASSISTANT_H3_STAGE_EVENTS = frozenset({
    "minimax_h3_visual_contract_start",
    "minimax_h3_visual_contract_bounded_stage",
    "minimax_h3_visual_contract_blocked",
    "minimax_h3_visual_contract_complete",
})
COMFYUI_API_KEY_ENV = "NOVAFLOW_COMFYUI_API_KEY"
PREVIEW_PAID_IMAGE_PROVIDER_ENV = "NOVAFLOW_PREVIEW_ALLOW_PAID_IMAGE_PROVIDER"
COMFY_API_PROVIDER_NODE_TYPES = {
    "KlingVideoNode",
    "KlingFirstLastFrameNode",
    "KlingOmniProImageToVideoNode",
    "ByteDance2ReferenceNode",
    "ByteDance2FirstLastFrameNode",
    "OpenAIGPTImage1",
    "OpenAIGPTImageNodeV2",
    "GeminiImageNode",
    "GeminiImage2Node",
}
COMFY_API_IMAGE_PROVIDER_NODE_TYPES = {
    "OpenAIGPTImage1",
    "OpenAIGPTImageNodeV2",
    "GeminiImageNode",
    "GeminiImage2Node",
}
HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}


def normalize_base_url(value: str | None) -> str:
    text = str(value or "").strip().rstrip("/")
    return text or DEFAULT_BASE_URL


def is_runtime_prompt_path(path: str) -> bool:
    suffix = path[len(PROXY_PREFIX):] if path.startswith(PROXY_PREFIX) else path
    clean_path = suffix.split("?", 1)[0].rstrip("/")
    return clean_path in {"/prompt", "/api/prompt"}


def is_legacy_aifx_prompt_body(body: bytes | None) -> bool:
    if not body:
        return False
    text = body.decode("utf-8", errors="ignore").lower()
    return "novaflow_aifx" in text or "novaflow-aifx" in text


def read_windows_user_env_value(name: str) -> str:
    if os.name != "nt":
        return ""
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            value, _value_type = winreg.QueryValueEx(key, name)
            return str(value or "").strip()
    except Exception:
        return ""


def read_comfy_api_key_for_runtime_prompt() -> str:
    return str(os.environ.get(COMFYUI_API_KEY_ENV) or "").strip() or read_windows_user_env_value(COMFYUI_API_KEY_ENV)


def runtime_prompt_provider_node_types(value: object) -> set[str]:
    if not isinstance(value, dict):
        return set()
    prompt = value.get("prompt") if isinstance(value.get("prompt"), dict) else value
    if not isinstance(prompt, dict):
        return set()
    matches: set[str] = set()
    for node in prompt.values():
        if not isinstance(node, dict):
            continue
        node_type = str(node.get("class_type") or node.get("classType") or node.get("type") or "")
        if node_type in COMFY_API_PROVIDER_NODE_TYPES:
            matches.add(node_type)
    return matches


def runtime_prompt_contains_comfy_api_provider(value: object) -> bool:
    return bool(runtime_prompt_provider_node_types(value))


def preview_paid_image_provider_block_reason(path: str, method: str, body: bytes | None) -> str:
    if str(os.environ.get(PREVIEW_PAID_IMAGE_PROVIDER_ENV) or "").strip() == "1":
        return ""
    if str(method or "GET").upper() != "POST" or not is_runtime_prompt_path(path) or not body:
        return ""
    try:
        payload = json.loads(body.decode("utf-8-sig"))
    except Exception:
        return ""
    if runtime_prompt_provider_node_types(payload) & COMFY_API_IMAGE_PROVIDER_NODE_TYPES:
        return "preview_paid_image_provider_requires_desktop"
    return ""


def inject_comfy_api_credentials_into_prompt_body(path: str, method: str, body: bytes | None) -> bytes | None:
    if str(method or "GET").upper() != "POST":
        return body
    if not is_runtime_prompt_path(path):
        return body
    if not body:
        return body
    try:
        payload = json.loads(body.decode("utf-8-sig"))
    except Exception:
        return body
    if not runtime_prompt_contains_comfy_api_provider(payload):
        return body
    api_key = read_comfy_api_key_for_runtime_prompt()
    if not api_key:
        return body
    extra_data = payload.get("extra_data")
    if not isinstance(extra_data, dict):
        extra_data = {}
        payload["extra_data"] = extra_data
    if not extra_data.get("auth_token_comfy_org") and not extra_data.get("api_key_comfy_org"):
        extra_data["api_key_comfy_org"] = api_key
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _json_bytes(data: dict) -> bytes:
    return json.dumps(data, ensure_ascii=False).encode("utf-8")


def _strip_data_url(value: str) -> tuple[str, bytes]:
    text = str(value or "")
    if "," in text and text.lower().startswith("data:"):
        header, payload = text.split(",", 1)
        mime = header.split(";", 1)[0].replace("data:", "") or "image/png"
        return mime, base64.b64decode(payload)
    return "application/octet-stream", base64.b64decode(text)


def _write_data_url_image(data_url: str, target: Path) -> None:
    _mime, payload = _strip_data_url(data_url)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)


def _file_to_data_url(path: Path) -> str:
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{payload}"


def _get_system_mouse_position() -> dict:
    if os.name != "nt":
        return {"ok": False, "error": "system mouse position is only available on Windows"}
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        point = wintypes.POINT()
        ok = user32.GetCursorPos(ctypes.byref(point))
        if not ok:
            return {"ok": False, "error": "GetCursorPos failed"}
        buttons = {
            "left": bool(user32.GetAsyncKeyState(0x01) & 0x8000),
            "right": bool(user32.GetAsyncKeyState(0x02) & 0x8000),
            "middle": bool(user32.GetAsyncKeyState(0x04) & 0x8000),
        }
        return {
            "ok": True,
            "x": int(point.x),
            "y": int(point.y),
            "source": "win32",
            "buttons": buttons,
            "leftDown": buttons["left"],
            "rightDown": buttons["right"],
            "middleDown": buttons["middle"],
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _admin_server_script() -> Path:
    return Path(__file__).resolve().parents[1] / "particle-editor-desktop" / "admin-server" / "server.js"


def _admin_server_build_id() -> str:
    script_path = _admin_server_script()
    try:
        return hashlib.sha256(script_path.read_bytes()).hexdigest()
    except OSError:
        return ""


def _admin_server_node_executable() -> str:
    candidates = [
        str(os.environ.get("NOVAFLOW_NODE_EXECUTABLE") or "").strip(),
        str(os.environ.get("npm_node_execpath") or "").strip(),
        str(shutil.which("node") or "").strip(),
    ]
    return next((candidate for candidate in candidates if candidate and Path(candidate).is_file()), "")


def _is_novaflow_admin_health_payload(payload: object) -> bool:
    return (
        isinstance(payload, dict)
        and payload.get("ok") is True
        and str(payload.get("service") or "").strip() == "NovaFlow Admin Server"
        and str(payload.get("status") or "").strip().lower() == "running"
    )


def _read_novaflow_admin_health_payload(timeout: float = 1.2) -> tuple[dict | None, str]:
    try:
        request = Request(
            ADMIN_SERVER_HEALTH_URL,
            method="GET",
            headers={"Accept": "application/json", "User-Agent": "NovaFlowPreview/1.0"},
        )
        with urlopen(request, timeout=max(0.2, float(timeout))) as response:
            status = int(getattr(response, "status", 0) or 0)
            payload = json.loads(response.read(64 * 1024).decode("utf-8-sig"))
        if status == 200 and _is_novaflow_admin_health_payload(payload):
            return payload, ""
        return None, f"unexpected health response (HTTP {status})"
    except Exception as exc:
        return None, str(exc)[:240]


def _normalize_windows_absolute_path(value: object) -> str:
    text = str(value or "").strip().strip('"')
    if not text or not ntpath.isabs(text):
        return ""
    return ntpath.normcase(ntpath.normpath(text))


def _windows_admin_process_identity_matches(payload: object, pid: int) -> tuple[bool, str]:
    if not isinstance(payload, dict):
        return False, "process query returned no identity"
    process_id = payload.get("ProcessId")
    if isinstance(process_id, bool) or not isinstance(process_id, int) or process_id != pid:
        return False, "process query returned a different PID"

    executable_path = str(payload.get("ExecutablePath") or "").strip()
    command_line = str(payload.get("CommandLine") or "").strip()
    if not executable_path or not command_line:
        return False, "process executable path or command line is unavailable"

    # Preview starts this process with exactly [node, absolute server.js]. Accepting
    # options or extra arguments would make a spoofed command line ambiguous.
    match = re.fullmatch(
        r'\s*(?:"([^"]+)"|(\S+))\s+(?:"([^"]+)"|(\S+))\s*',
        command_line,
    )
    if not match:
        return False, "process command line is not the expected two-argument Node invocation"
    command_executable = match.group(1) or match.group(2) or ""
    command_script = match.group(3) or match.group(4) or ""

    normalized_executable = _normalize_windows_absolute_path(executable_path)
    normalized_command_executable = _normalize_windows_absolute_path(command_executable)
    normalized_command_script = _normalize_windows_absolute_path(command_script)
    normalized_expected_script = _normalize_windows_absolute_path(_admin_server_script())
    if not all((
        normalized_executable,
        normalized_command_executable,
        normalized_command_script,
        normalized_expected_script,
    )):
        return False, "process command line does not contain absolute executable and script paths"
    if normalized_executable != normalized_command_executable:
        return False, "process executable path does not match its command line"
    if ntpath.basename(normalized_executable) not in {"node", "node.exe"}:
        return False, "process executable is not Node.js"
    if normalized_command_script != normalized_expected_script:
        return False, "process script path does not match the current NovaFlow admin server"
    return True, ""


def _read_windows_process_identity(pid: int, timeout: float = 2.5) -> tuple[dict | None, str]:
    powershell = str(shutil.which("powershell.exe") or shutil.which("powershell") or "").strip()
    if not powershell:
        return None, "PowerShell is unavailable for process identity verification"
    command = (
        "$ErrorActionPreference='Stop';"
        "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);"
        f"$target=Get-CimInstance -ClassName Win32_Process -Filter \"ProcessId = {int(pid)}\";"
        "if ($null -eq $target) { throw 'process not found' };"
        "$target | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"
    )
    try:
        completed = subprocess.run(
            [powershell, "-NoProfile", "-NonInteractive", "-Command", command],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8-sig",
            errors="replace",
            timeout=max(0.5, float(timeout)),
            creationflags=ADMIN_SERVER_CREATION_FLAGS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, f"process identity query failed: {str(exc)[:160]}"
    if completed.returncode != 0:
        detail = str(completed.stderr or "").strip().replace("\r", " ").replace("\n", " ")[:160]
        return None, "process identity query failed" + (f": {detail}" if detail else "")
    try:
        payload = json.loads(str(completed.stdout or "").strip())
    except (TypeError, ValueError, json.JSONDecodeError):
        return None, "process identity query returned invalid JSON"
    return (payload, "") if isinstance(payload, dict) else (None, "process identity query returned no identity")


def _admin_server_process_identity_trusted(pid: int) -> tuple[bool, str]:
    if os.name != "nt":
        return True, ""
    payload, error = _read_windows_process_identity(pid)
    if payload is None:
        return False, error or "process identity could not be verified"
    return _windows_admin_process_identity_matches(payload, pid)


def _probe_novaflow_admin_server(timeout: float = 1.2) -> tuple[bool, str]:
    payload, error = _read_novaflow_admin_health_payload(timeout)
    if payload is None:
        return False, error
    expected_build_id = _admin_server_build_id()
    actual_build_id = str(payload.get("buildId") or "").strip().lower()
    if not expected_build_id or actual_build_id != expected_build_id:
        return False, "NovaFlow admin server build identity mismatch"
    return True, ""


def _admin_server_port_is_open(timeout: float = 0.35) -> bool:
    try:
        with socket.create_connection(
            (ADMIN_SERVER_HOST, ADMIN_SERVER_PORT),
            timeout=max(0.1, float(timeout)),
        ):
            return True
    except OSError:
        return False


def _wait_for_novaflow_admin_server(proc: subprocess.Popen, timeout: float = 7.0) -> tuple[bool, str]:
    deadline = time.time() + max(1.0, float(timeout))
    last_error = "admin server health check failed"
    while time.time() < deadline:
        healthy, error = _probe_novaflow_admin_server()
        if healthy:
            return True, ""
        last_error = error or last_error
        if proc.poll() is not None:
            return False, f"admin server exited with code {proc.returncode}: {last_error}"
        time.sleep(0.25)
    return False, last_error


def _stop_stale_novaflow_admin_server(payload: object, wait_timeout: float = 3.0) -> tuple[bool, str]:
    if not _is_novaflow_admin_health_payload(payload):
        return False, "health response is not a trusted NovaFlow admin payload"
    pid_value = payload.get("pid") if isinstance(payload, dict) else None
    if isinstance(pid_value, bool) or not isinstance(pid_value, int):
        return False, "health response does not contain a valid PID"
    pid = int(pid_value)
    if pid <= 0 or pid == os.getpid():
        return False, "health response contains an unsafe PID"
    identity_trusted, identity_error = _admin_server_process_identity_trusted(pid)
    if not identity_trusted:
        return False, "process identity is untrusted: " + (
            identity_error or "absolute admin server script path could not be verified"
        )
    try:
        os.kill(pid, signal.SIGTERM)
    except (OSError, ProcessLookupError):
        return False, "verified stale process could not be terminated"
    deadline = time.time() + max(0.5, float(wait_timeout))
    while time.time() < deadline:
        if not _admin_server_port_is_open():
            return True, ""
        time.sleep(0.1)
    if not _admin_server_port_is_open():
        return True, ""
    return False, "verified stale process did not release port 4761"


def _stop_owned_novaflow_admin_server(wait_timeout: float = 3.0) -> None:
    global ADMIN_SERVER_PROCESS
    with ADMIN_SERVER_PROCESS_LOCK:
        proc = ADMIN_SERVER_PROCESS
        ADMIN_SERVER_PROCESS = None
    if not proc:
        return
    if proc.poll() is None:
        with contextlib.suppress(Exception):
            proc.terminate()
        try:
            proc.wait(timeout=max(0.2, float(wait_timeout)))
        except subprocess.TimeoutExpired:
            with contextlib.suppress(Exception):
                proc.kill()
            with contextlib.suppress(Exception):
                proc.wait(timeout=1.0)


def _ensure_novaflow_admin_server(preview_host: str, preview_port: int) -> dict:
    global ADMIN_SERVER_PROCESS

    expected_build_id = _admin_server_build_id()
    health_payload, health_error = _read_novaflow_admin_health_payload()
    if health_payload is not None:
        actual_build_id = str(health_payload.get("buildId") or "").strip().lower()
        if expected_build_id and actual_build_id == expected_build_id:
            return {
                "ok": True,
                "owned": False,
                "reused": True,
                "buildId": expected_build_id,
                "baseUrl": f"http://{ADMIN_SERVER_HOST}:{ADMIN_SERVER_PORT}",
            }
        stale_stopped, stale_stop_error = _stop_stale_novaflow_admin_server(health_payload)
        if not stale_stopped:
            raise RuntimeError(
                "NovaFlow Preview Grok unavailable: 127.0.0.1:4761 is occupied by a stale NovaFlow build "
                "and could not be restarted safely"
                + (f" ({stale_stop_error})" if stale_stop_error else "")
            )
    if _admin_server_port_is_open():
        raise RuntimeError(
            "NovaFlow Preview Grok unavailable: 127.0.0.1:4761 is occupied by a non-NovaFlow or unhealthy service"
            + (f" ({health_error})" if health_error else "")
        )

    script_path = _admin_server_script()
    node_executable = _admin_server_node_executable()
    if not script_path.is_file():
        raise RuntimeError(f"NovaFlow Preview Grok unavailable: admin server script missing: {script_path}")
    if not node_executable:
        raise RuntimeError("NovaFlow Preview Grok unavailable: Node.js executable not found")

    cors_origins = {
        f"http://127.0.0.1:{int(preview_port)}",
        f"http://localhost:{int(preview_port)}",
    }
    normalized_preview_host = str(preview_host or "").strip()
    if normalized_preview_host and normalized_preview_host not in {"0.0.0.0", "::"}:
        cors_origins.add(f"http://{normalized_preview_host}:{int(preview_port)}")
    env = os.environ.copy()
    env["NOVAFLOW_ADMIN_SERVER_HOST"] = ADMIN_SERVER_HOST
    env["NOVAFLOW_ADMIN_SERVER_PORT"] = str(ADMIN_SERVER_PORT)
    env["NOVAFLOW_ADMIN_SERVER_CORS_ORIGINS"] = ",".join(sorted(cors_origins))
    env["NOVAFLOW_ADMIN_SERVER_REQUEST_LOGS"] = "0"

    proc = subprocess.Popen(
        [node_executable, str(script_path)],
        cwd=str(script_path.parent),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
        creationflags=ADMIN_SERVER_CREATION_FLAGS,
    )
    ready, error = _wait_for_novaflow_admin_server(proc)
    if not ready:
        if proc.poll() is None:
            with contextlib.suppress(Exception):
                proc.terminate()
            with contextlib.suppress(Exception):
                proc.wait(timeout=2.0)
        raise RuntimeError(f"NovaFlow Preview Grok unavailable: {error}")

    # A concurrent healthy NovaFlow server can win the port race. Own only the child that is still alive.
    if proc.poll() is None:
        with ADMIN_SERVER_PROCESS_LOCK:
            ADMIN_SERVER_PROCESS = proc
        return {
            "ok": True,
            "owned": True,
            "reused": False,
            "buildId": expected_build_id,
            "baseUrl": f"http://{ADMIN_SERVER_HOST}:{ADMIN_SERVER_PORT}",
        }
    return {
        "ok": True,
        "owned": False,
        "reused": True,
        "buildId": expected_build_id,
        "baseUrl": f"http://{ADMIN_SERVER_HOST}:{ADMIN_SERVER_PORT}",
    }


def _prompt_assistant_runtime_json_path() -> Path:
    return Path(os.environ.get("NOVAFLOW_RUNTIME_JSON") or str(PROMPT_ASSISTANT_DEFAULT_RUNTIME_JSON))


def _read_prompt_assistant_runtime_config() -> dict:
    path = _prompt_assistant_runtime_json_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _resolve_prompt_assistant_model_path(runtime_config: dict) -> Path:
    override = str(os.environ.get("NOVAFLOW_PROMPT_ASSISTANT_MODEL_PATH") or "").strip()
    candidates: list[Path] = []
    if override:
        candidates.append(Path(override))
    candidates.append(PROMPT_ASSISTANT_DEFAULT_MODEL_PATH)
    models_path = str(runtime_config.get("modelsPath") or "").strip()
    if models_path:
        candidates.append(Path(models_path) / "text_encoders" / PROMPT_ASSISTANT_MODEL_NAME)
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def _is_prompt_assistant_reverse_model_dir(candidate: Path | str | None) -> bool:
    if not candidate:
        return False
    try:
        root = Path(candidate).resolve(strict=True)
        if not root.is_dir():
            return False
        for name in ("config.json", "tokenizer_config.json", "preprocessor_config.json"):
            if not (root / name).is_file():
                return False
        model_config = json.loads((root / "config.json").read_text(encoding="utf-8"))
        architectures = model_config.get("architectures") if isinstance(model_config, dict) else None
        if not isinstance(architectures, list) or "Qwen3VLForConditionalGeneration" not in architectures:
            return False
        if (root / "model.safetensors").is_file():
            return True
        index_path = root / "model.safetensors.index.json"
        if not index_path.is_file():
            return False
        manifest = json.loads(index_path.read_text(encoding="utf-8"))
        weight_map = manifest.get("weight_map") if isinstance(manifest, dict) else None
        if not isinstance(weight_map, dict):
            return False
        shard_names = sorted({str(name or "").strip() for name in weight_map.values() if str(name or "").strip()})
        if not shard_names:
            return False
        for shard_name in shard_names:
            shard_path = (root / shard_name).resolve(strict=True)
            if shard_path == root or root not in shard_path.parents or not shard_path.is_file():
                return False
        return True
    except Exception:
        return False


def _resolve_prompt_assistant_reverse_model_path(runtime_config: dict) -> Path:
    override = str(os.environ.get("NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_PATH") or "").strip()
    candidates: list[Path] = []
    if override:
        candidates.append(Path(override))
    configured = str(runtime_config.get("promptAssistantReverseModelPath") or "").strip()
    if configured:
        candidates.append(Path(configured))
    candidates.append(PROMPT_ASSISTANT_REVERSE_DEFAULT_MODEL_PATH)
    models_path = str(runtime_config.get("modelsPath") or "").strip()
    if models_path:
        candidates.append(Path(models_path) / "prompt_assistant" / PROMPT_ASSISTANT_REVERSE_MODEL_DIR_NAME)
        candidates.append(Path(models_path) / "vlm" / PROMPT_ASSISTANT_REVERSE_MODEL_DIR_NAME)
    for candidate in candidates:
        if _is_prompt_assistant_reverse_model_dir(candidate):
            return candidate
    return candidates[0]


def _resolve_prompt_assistant_python(runtime_config: dict) -> str:
    override = str(os.environ.get("NOVAFLOW_PROMPT_ASSISTANT_PYTHON") or "").strip()
    if override:
        return override
    install_path = str(runtime_config.get("installPath") or "").strip()
    runtime_python = Path(install_path) / "engine" / "python" / "python.exe" if install_path else None
    if runtime_python and runtime_python.exists():
        return str(runtime_python)
    return sys.executable


def _prompt_assistant_service_script() -> Path:
    return Path(__file__).resolve().parents[1] / "particle-editor-desktop" / "prompt-assistant-service.py"


def _prompt_assistant_config() -> dict:
    runtime_config = _read_prompt_assistant_runtime_config()
    model_path = _resolve_prompt_assistant_model_path(runtime_config)
    reverse_model_path = _resolve_prompt_assistant_reverse_model_path(runtime_config)
    service_script = _prompt_assistant_service_script()
    model_exists = model_path.exists()
    reverse_model_exists = _is_prompt_assistant_reverse_model_dir(reverse_model_path)
    service_exists = service_script.exists()
    any_model_exists = model_exists or reverse_model_exists
    return {
        "ok": any_model_exists and service_exists,
        "modelType": PROMPT_ASSISTANT_MODEL_TYPE,
        "modelPath": str(model_path),
        "reverseModelType": PROMPT_ASSISTANT_REVERSE_MODEL_TYPE,
        "reverseModelPath": str(reverse_model_path),
        "reverseModelEnabled": reverse_model_exists,
        "modelExists": model_exists,
        "serviceExists": service_exists,
        "enabled": model_exists and service_exists,
        "runtimeStatus": (
            "模型可用" if model_exists and service_exists
            else ("图片反推模型可用" if reverse_model_exists and service_exists else "未配置模型")
        ),
        "serviceScript": str(service_script),
        "pythonPath": _resolve_prompt_assistant_python(runtime_config),
        "runtimeConfig": runtime_config,
        "warning": PROMPT_ASSISTANT_LAST_WARNING,
        "error": "" if any_model_exists and service_exists else (
            "Prompt Assistant 服务脚本不存在" if any_model_exists else "未配置模型"
        ),
    }


def _append_prompt_assistant_stderr(line: str) -> None:
    text = str(line or "").strip()
    if not text:
        return
    _persist_prompt_assistant_h3_stage(text)
    with PROMPT_ASSISTANT_STDERR_LOCK:
        PROMPT_ASSISTANT_STDERR_TAIL.append(text)
        del PROMPT_ASSISTANT_STDERR_TAIL[:-40]


def _persist_prompt_assistant_h3_stage(line: str) -> None:
    try:
        source = json.loads(str(line or ""))
    except (TypeError, ValueError, json.JSONDecodeError):
        return
    if not isinstance(source, dict) or source.get("event") not in PROMPT_ASSISTANT_H3_STAGE_EVENTS:
        return

    record: dict = {
        "recordedAtMs": int(time.time() * 1000),
        "event": str(source.get("event") or "")[:64],
    }
    for field, maximum in (
        ("command", 32),
        ("mode", 16),
        ("visualSchema", 40),
        ("stage", 48),
        ("outcome", 32),
        ("reasonCode", 80),
        ("errorCode", 80),
        ("provider", 64),
    ):
        value = re.sub(r"[^a-zA-Z0-9_.:-]+", "-", str(source.get(field) or "")).strip("-")[:maximum]
        if value:
            record[field] = value
    for field in (
        "pictureIndex",
        "attempt",
        "imageCount",
        "completedStages",
        "visualFactCalls",
        "interactionIrRepairCalls",
        "interactionDeactivationFallbacks",
        "sensitiveIrReviewCalls",
        "h3CompileCalls",
        "repairCalls",
    ):
        value = source.get(field)
        if isinstance(value, int) and not isinstance(value, bool):
            record[field] = max(0, min(32, value))
    for field in (
        "interactionDeactivationFallback",
        "deterministicVisualFallback",
        "sensitiveVisualAnalysis",
    ):
        if isinstance(source.get(field), bool):
            record[field] = source[field]

    encoded = json.dumps(record, ensure_ascii=True, separators=(",", ":")) + "\n"
    try:
        with PROMPT_ASSISTANT_H3_STAGE_LOG_LOCK:
            PROMPT_ASSISTANT_H3_STAGE_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
            if (
                PROMPT_ASSISTANT_H3_STAGE_LOG_PATH.exists()
                and PROMPT_ASSISTANT_H3_STAGE_LOG_PATH.stat().st_size > 512 * 1024
            ):
                existing = PROMPT_ASSISTANT_H3_STAGE_LOG_PATH.read_text(
                    encoding="utf-8", errors="ignore"
                ).splitlines()[-256:]
                PROMPT_ASSISTANT_H3_STAGE_LOG_PATH.write_text(
                    ("\n".join(existing) + "\n") if existing else "",
                    encoding="utf-8",
                )
            with PROMPT_ASSISTANT_H3_STAGE_LOG_PATH.open("a", encoding="utf-8", newline="\n") as stream:
                stream.write(encoded)
    except OSError:
        return


def _prompt_assistant_stderr_text() -> str:
    with PROMPT_ASSISTANT_STDERR_LOCK:
        return "\n".join(PROMPT_ASSISTANT_STDERR_TAIL[-6:])


def _drain_prompt_assistant_stdout(proc: subprocess.Popen, out_queue: queue.Queue) -> None:
    try:
        for line in proc.stdout or []:
            out_queue.put(line)
    finally:
        out_queue.put(None)


def _drain_prompt_assistant_stderr(proc: subprocess.Popen) -> None:
    for line in proc.stderr or []:
        _append_prompt_assistant_stderr(line)


def _prompt_assistant_process_pid_alive(pid: int) -> bool | None:
    if pid <= 0:
        return False
    if os.name == "nt":
        return _prompt_assistant_windows_process_alive(pid)
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except ProcessLookupError:
        return False
    except (OSError, SystemError, ValueError):
        return None


def _prompt_assistant_child_process_alive(proc: subprocess.Popen | None) -> bool | None:
    """Return a reliable child state without trusting a poisoned Popen handle."""

    if proc is None:
        return False
    try:
        return proc.poll() is None
    except (OSError, SystemError, TypeError, ValueError):
        try:
            pid = int(getattr(proc, "pid", 0) or 0)
        except (TypeError, ValueError, OverflowError):
            return None
        return _prompt_assistant_process_pid_alive(pid)


def _stop_prompt_assistant_process(wait_timeout: float = 5.0) -> str:
    global PROMPT_ASSISTANT_PROCESS, PROMPT_ASSISTANT_STDOUT_QUEUE
    proc = PROMPT_ASSISTANT_PROCESS
    if not proc:
        return "not-running"
    with contextlib.suppress(Exception):
        if proc.stdin:
            proc.stdin.write(json.dumps({"command": "shutdown"}) + "\n")
            proc.stdin.flush()
    deadline = time.time() + max(0.5, float(wait_timeout))
    alive = _prompt_assistant_child_process_alive(proc)
    if alive is None:
        return "stop-timeout"
    if alive:
        try:
            proc.wait(timeout=min(1.5, max(0.2, deadline - time.time())))
        except subprocess.TimeoutExpired:
            with contextlib.suppress(Exception):
                proc.terminate()
        except (OSError, SystemError, TypeError, ValueError):
            if _prompt_assistant_child_process_alive(proc) is not False:
                return "stop-timeout"
    alive = _prompt_assistant_child_process_alive(proc)
    if alive is None:
        return "stop-timeout"
    if alive:
        try:
            proc.wait(timeout=min(2.0, max(0.2, deadline - time.time())))
        except subprocess.TimeoutExpired:
            with contextlib.suppress(Exception):
                proc.kill()
        except (OSError, SystemError, TypeError, ValueError):
            if _prompt_assistant_child_process_alive(proc) is not False:
                return "stop-timeout"
    alive = _prompt_assistant_child_process_alive(proc)
    if alive is None:
        return "stop-timeout"
    if alive:
        try:
            proc.wait(timeout=max(0.2, deadline - time.time()))
        except subprocess.TimeoutExpired:
            pass
        except (OSError, SystemError, TypeError, ValueError):
            if _prompt_assistant_child_process_alive(proc) is not False:
                return "stop-timeout"
    alive = _prompt_assistant_child_process_alive(proc)
    if alive is not False:
        # Keep the live or indeterminate reference so _ensure cannot spawn a
        # second model child after a failed cleanup attempt.
        return "stop-timeout"
    for stream in (proc.stdin, proc.stdout, proc.stderr):
        with contextlib.suppress(Exception):
            if stream:
                stream.close()
    if PROMPT_ASSISTANT_PROCESS is proc:
        PROMPT_ASSISTANT_PROCESS = None
        PROMPT_ASSISTANT_STDOUT_QUEUE = None
    return "stopped"


def _is_ordinary_local_art_prompt_patch(payload: dict | None) -> bool:
    source = payload if isinstance(payload, dict) else {}
    provider = str(source.get("provider") or "local").strip().lower()
    surface = str(source.get("surface") or "").strip().lower().replace("_", "-")
    purpose = str(source.get("purpose") or "").strip().lower().replace("_", "-")
    return (
        provider == "local"
        and purpose == "optimize"
        and bool(str(source.get("currentPrompt") or "").strip())
        and surface in {"", "art", "drawing", "image"}
    )


def _prompt_assistant_runtime_request_json(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    timeout: float = 2.5,
    body: dict | None = None,
) -> dict:
    target = f"{normalize_base_url(base_url).rstrip('/')}/{str(path or '').lstrip('/')}"
    data = json.dumps(body or {}, ensure_ascii=False).encode("utf-8") if method.upper() != "GET" else None
    request = Request(
        target,
        data=data,
        method=method.upper(),
        headers={
            "Accept": "application/json",
            **({"Content-Type": "application/json"} if data is not None else {}),
        },
    )
    try:
        with urlopen(request, timeout=max(0.2, float(timeout))) as response:
            status = int(getattr(response, "status", 0) or 0)
            raw = response.read(1024 * 1024).decode("utf-8-sig", errors="replace")
    except HTTPError as exc:
        return {
            "ok": False,
            "available": True,
            "status": int(getattr(exc, "code", 0) or 0),
            "error": f"HTTP {int(getattr(exc, 'code', 0) or 0)}",
        }
    except (URLError, TimeoutError, socket.timeout, OSError) as exc:
        reason = exc.reason if isinstance(exc, URLError) else exc
        errno_value = getattr(reason, "errno", None)
        winerror_value = getattr(reason, "winerror", None)
        message = re.sub(r"\s+", " ", str(reason or exc)).strip()[:160] or "runtime_transport_error"
        no_listener = isinstance(reason, ConnectionRefusedError) or errno_value in {61, 111, 10061} or winerror_value == 10061
        timed_out = isinstance(reason, (TimeoutError, socket.timeout)) or errno_value in {60, 110, 10060} or winerror_value == 10060
        return {
            "ok": False,
            "available": False,
            "transportState": "no-listener" if no_listener and not timed_out else "indeterminate",
            "noListener": bool(no_listener and not timed_out),
            "error": "timeout" if timed_out else message,
        }
    if status < 200 or status >= 300:
        return {"ok": False, "available": True, "status": status, "error": f"HTTP {status}"}
    try:
        payload = json.loads(raw or "{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        return {"ok": False, "available": True, "status": status, "error": "invalid_json"}
    return {"ok": True, "available": True, "status": status, "data": payload}


def _inspect_prompt_assistant_runtime_queue(base_url: str, timeout: float = 2.5) -> dict:
    response = _prompt_assistant_runtime_request_json(base_url, "/queue", timeout=timeout)
    if not response.get("ok"):
        return {
            **response,
            "state": "no-listener" if response.get("noListener") else "indeterminate",
        }
    payload = response.get("data") if isinstance(response.get("data"), dict) else {}
    running_queue = payload.get("queue_running")
    pending_queue = payload.get("queue_pending")
    if not isinstance(running_queue, list) or not isinstance(pending_queue, list):
        return {
            "ok": False,
            "available": True,
            "state": "indeterminate",
            "error": "invalid_queue_shape",
        }
    running = len(running_queue)
    pending = len(pending_queue)
    return {
        "ok": True,
        "available": True,
        "state": "busy" if running or pending else "idle",
        "running": running,
        "pending": pending,
    }


def _request_prompt_assistant_runtime_free_memory(base_url: str, timeout: float = 15.0) -> dict:
    body = {"unload_models": True, "free_memory": True}
    response = _prompt_assistant_runtime_request_json(
        base_url,
        "/free",
        method="POST",
        timeout=timeout,
        body=body,
    )
    if response.get("status") == 404:
        return _prompt_assistant_runtime_request_json(
            base_url,
            "/api/free",
            method="POST",
            timeout=timeout,
            body=body,
        )
    return response


def _prompt_assistant_windows_process_alive(pid: int, kernel32=None) -> bool | None:
    """Return True/False when Windows can prove liveness, otherwise None."""

    if pid <= 0:
        return False
    try:
        import ctypes
        from ctypes import wintypes

        api = kernel32 or ctypes.WinDLL("kernel32", use_last_error=True)
        open_process = api.OpenProcess
        get_exit_code = api.GetExitCodeProcess
        close_handle = api.CloseHandle
        open_process.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        open_process.restype = wintypes.HANDLE
        get_exit_code.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
        get_exit_code.restype = wintypes.BOOL
        close_handle.argtypes = (wintypes.HANDLE,)
        close_handle.restype = wintypes.BOOL
        ctypes.set_last_error(0)
        handle = open_process(0x1000, False, int(pid))  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            error_code = int(ctypes.get_last_error() or 0)
            # ERROR_INVALID_PARAMETER / ERROR_NOT_FOUND prove that the PID is dead.
            return False if error_code in {87, 1168} else None
        try:
            exit_code = wintypes.DWORD(0)
            if not get_exit_code(handle, ctypes.byref(exit_code)):
                return None
            return int(exit_code.value) == 259  # STILL_ACTIVE
        finally:
            close_handle(handle)
    except (OSError, SystemError, TypeError, ValueError, AttributeError):
        return None


def _prompt_assistant_runtime_process_alive(runtime_config: dict | None = None) -> bool | None:
    config = runtime_config if isinstance(runtime_config, dict) else _read_prompt_assistant_runtime_config()
    generated_candidates = [
        str(config.get("generatedPath") or "").strip(),
        str(os.environ.get("NOVAFLOW_AI_RUNTIME_GENERATED_DIR") or "").strip(),
        str(Path(tempfile.gettempdir()) / "NovaFlow" / "AI-Runtime" / "runtime-generated"),
    ]
    uncertain = False
    for generated_path in generated_candidates:
        if not generated_path:
            continue
        try:
            pid_text = (Path(generated_path) / "runtime.pid").read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            continue
        except (OSError, SystemError):
            uncertain = True
            continue
        if not pid_text.isdigit():
            continue
        pid = int(pid_text)
        if pid <= 0:
            continue
        try:
            if os.name == "nt":
                state = _prompt_assistant_windows_process_alive(pid)
                if state is True:
                    return True
                if state is None:
                    uncertain = True
                continue
            os.kill(pid, 0)
            return True
        except PermissionError:
            return True
        except ProcessLookupError:
            continue
        except (OSError, SystemError, ValueError):
            uncertain = True
    return None if uncertain else False


def _prepare_prompt_assistant_resource_handoff(base_url: str) -> dict:
    queue_state = _inspect_prompt_assistant_runtime_queue(base_url)
    if queue_state.get("ok"):
        runtime_process_alive: bool | None = None
    else:
        runtime_process_alive = _prompt_assistant_runtime_process_alive()
    if queue_state.get("state") == "no-listener" and runtime_process_alive is False:
        return {
            "ok": True,
            "state": "runtime-unavailable-independent",
            "runtimeAvailable": False,
            "released": False,
            "error": str(queue_state.get("error") or "runtime_unavailable")[:160],
        }
    if not queue_state.get("ok"):
        return {
            "ok": False,
            "state": "runtime-queue-indeterminate",
            "runtimeAvailable": bool(runtime_process_alive is not False or queue_state.get("available") is not False),
            "released": False,
            "errorCode": "runtime-queue-indeterminate",
            "error": (
                "绘图 Runtime 进程仍在运行，但无法确认队列状态，请稍后重试"
                if runtime_process_alive is True else (
                    "无法可靠确认绘图 Runtime 进程状态，请稍后重试"
                    if runtime_process_alive is None else "无法确认绘图队列状态，请稍后重试"
                )
            ),
        }
    if queue_state.get("state") == "busy":
        return {
            "ok": False,
            "state": "runtime-generation-busy",
            "runtimeAvailable": True,
            "released": False,
            "running": int(queue_state.get("running") or 0),
            "pending": int(queue_state.get("pending") or 0),
            "errorCode": "runtime-generation-busy",
            "error": "绘图模型正在生成或排队，请等待绘图完成后再优化提示词",
        }
    released = _request_prompt_assistant_runtime_free_memory(base_url)
    if not released.get("ok"):
        return {
            "ok": False,
            "state": "runtime-memory-release-failed",
            "runtimeAvailable": True,
            "released": False,
            "running": 0,
            "pending": 0,
            "errorCode": "runtime-memory-release-failed",
            "error": "绘图模型显存释放失败，请稍后重试",
        }
    verified_queue_state = _inspect_prompt_assistant_runtime_queue(base_url)
    if not verified_queue_state.get("ok") or verified_queue_state.get("state") != "idle":
        return {
            "ok": False,
            "state": "runtime-post-release-queue-not-idle",
            "runtimeAvailable": verified_queue_state.get("available") is not False,
            "released": True,
            "running": int(verified_queue_state.get("running") or 0),
            "pending": int(verified_queue_state.get("pending") or 0),
            "errorCode": "runtime-post-release-queue-not-idle",
            "error": "释放绘图模型后队列状态发生变化，请等待绘图完成后重试",
        }
    return {
        "ok": True,
        "state": "runtime-memory-released",
        "runtimeAvailable": True,
        "released": True,
        "running": 0,
        "pending": 0,
    }


def _trace_prompt_assistant_ordinary_art_patch(stage: str, metadata: dict | None = None) -> None:
    source = metadata if isinstance(metadata, dict) else {}
    record = {
        "event": "preview_prompt_assistant_ordinary_art_prompt_patch_stage",
        "command": "ordinaryArtPromptPatch",
        "stage": re.sub(r"[^a-z0-9_-]+", "-", str(stage or "unknown").lower()).strip("-")[:64] or "unknown",
        "elapsedMs": max(0, min(600_000, int(source.get("elapsedMs") or 0))),
    }
    runtime_state = re.sub(
        r"[^a-zA-Z0-9_.:-]+", "-", str(source.get("runtimeState") or "")
    ).strip("-")[:80]
    error_code = re.sub(
        r"[^a-zA-Z0-9_.:-]+", "-", str(source.get("errorCode") or "")
    ).strip("-")[:80]
    if runtime_state:
        record["runtimeState"] = runtime_state
    if error_code:
        record["errorCode"] = error_code
    for field in ("running", "pending"):
        if isinstance(source.get(field), int) and not isinstance(source.get(field), bool):
            record[field] = max(0, int(source[field]))
    for field in ("ok", "released"):
        if isinstance(source.get(field), bool):
            record[field] = source[field]
    print(json.dumps(record, ensure_ascii=True, separators=(",", ":")), file=sys.stderr, flush=True)


def _ensure_prompt_assistant_process(
    allow_reverse_only: bool = False,
    *,
    deadline_monotonic: float | None = None,
    caller_owns_cleanup: bool = False,
) -> tuple[subprocess.Popen, queue.Queue]:
    global PROMPT_ASSISTANT_PROCESS, PROMPT_ASSISTANT_STDOUT_QUEUE, PROMPT_ASSISTANT_STDERR_TAIL

    if deadline_monotonic is not None and time.monotonic() >= float(deadline_monotonic):
        raise TimeoutError("Prompt Assistant 总时限已耗尽")

    process_alive = _prompt_assistant_child_process_alive(PROMPT_ASSISTANT_PROCESS)
    if process_alive is True and PROMPT_ASSISTANT_STDOUT_QUEUE is not None:
        return PROMPT_ASSISTANT_PROCESS, PROMPT_ASSISTANT_STDOUT_QUEUE

    stop_result = _stop_prompt_assistant_process()
    if stop_result == "stop-timeout":
        raise PromptAssistantStartupError(
            "Prompt Assistant 旧进程状态无法确认，未启动第二个模型进程，请重试",
            "prompt-assistant-stop-timeout",
        )
    config = _prompt_assistant_config()
    can_start = bool(config.get("enabled")) or bool(
        allow_reverse_only and config.get("reverseModelEnabled") and config.get("serviceExists")
    )
    if not can_start:
        raise RuntimeError(str(config.get("error") or "Prompt Assistant 未配置"))

    runtime_config = config.get("runtimeConfig") or {}
    install_path = str(runtime_config.get("installPath") or "").strip()
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["NOVAFLOW_RUNTIME_JSON"] = str(_prompt_assistant_runtime_json_path())
    env["NOVAFLOW_PROMPT_ASSISTANT_MODEL_PATH"] = str(config.get("modelPath") or "")
    env["NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_PATH"] = str(config.get("reverseModelPath") or "")
    env["NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_TYPE"] = str(config.get("reverseModelType") or "")
    if install_path:
        env["NOVAFLOW_COMFY_ROOT"] = str(Path(install_path) / "engine" / "ComfyUI")

    with PROMPT_ASSISTANT_STDERR_LOCK:
        PROMPT_ASSISTANT_STDERR_TAIL = []

    proc = subprocess.Popen(
        [str(config.get("pythonPath")), str(config.get("serviceScript"))],
        cwd=str(Path(__file__).resolve().parents[1]),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        bufsize=1,
        creationflags=PROMPT_ASSISTANT_CREATION_FLAGS,
    )
    out_queue: queue.Queue = queue.Queue()
    threading.Thread(target=_drain_prompt_assistant_stdout, args=(proc, out_queue), daemon=True).start()
    threading.Thread(target=_drain_prompt_assistant_stderr, args=(proc,), daemon=True).start()
    PROMPT_ASSISTANT_PROCESS = proc
    PROMPT_ASSISTANT_STDOUT_QUEUE = out_queue

    if deadline_monotonic is None:
        startup_now = time.time
        deadline = startup_now() + 12
    else:
        startup_now = time.monotonic
        deadline = min(startup_now() + 12, float(deadline_monotonic))
    while startup_now() < deadline:
        process_alive = _prompt_assistant_child_process_alive(proc)
        if process_alive is False:
            detail = _prompt_assistant_stderr_text()
            return_code = proc.returncode
            if not caller_owns_cleanup:
                _stop_prompt_assistant_process()
            if return_code == 73:
                raise PromptAssistantStartupError(
                    "Prompt Assistant 本地模型正在另一个 NovaFlow 实例中使用，请等待当前任务完成后重试",
                    "prompt-assistant-already-running",
                )
            raise RuntimeError(f"Prompt Assistant 服务已退出：{detail or return_code}")
        if process_alive is None:
            if not caller_owns_cleanup:
                _stop_prompt_assistant_process()
            raise PromptAssistantStartupError(
                "Prompt Assistant 进程状态无法确认，请重试",
                "prompt-assistant-process-state-indeterminate",
            )
        try:
            remaining = max(0.0, deadline - startup_now())
            if remaining <= 0:
                break
            line = out_queue.get(timeout=min(0.2, remaining))
        except queue.Empty:
            continue
        if line is None:
            continue
        try:
            message = json.loads(str(line).strip())
        except Exception:
            continue
        if message.get("type") == "startup-error":
            error = PromptAssistantStartupError(
                str(message.get("error") or "Prompt Assistant 启动失败"),
                str(message.get("errorCode") or "prompt-assistant-startup-error"),
            )
            if not caller_owns_cleanup:
                _stop_prompt_assistant_process()
            raise error
        if message.get("type") == "ready":
            return proc, out_queue

    if not caller_owns_cleanup:
        _stop_prompt_assistant_process()
    raise RuntimeError("Prompt Assistant 服务启动超时")


def _normalize_prompt_assistant_mandatory_checklist(value) -> list[dict]:
    if not isinstance(value, list):
        return []
    checklist: list[dict] = []
    seen: set[str] = set()
    for item in value[:48]:
        if not isinstance(item, dict):
            continue
        checklist_token = str(item.get("checklistToken") or "").strip()
        semantic_token = str(item.get("semanticToken") or "").strip().lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", semantic_token):
            continue
        if not re.fullmatch(r"region-[1-9]\d{0,2}:[a-z0-9][a-z0-9-]{0,63}", checklist_token):
            continue
        if not checklist_token.endswith(f":{semantic_token}") or checklist_token in seen:
            continue
        seen.add(checklist_token)
        region_id = re.sub(r"[\x00-\x1f\x7f]+", " ", str(item.get("regionId") or ""))
        region_id = re.sub(r"\s+", " ", region_id).strip()[:120]
        kind = re.sub(r"[^a-z0-9_-]+", "", str(item.get("kind") or "").strip().lower())[:48]
        normalized = {
            "checklistToken": checklist_token,
            "regionId": region_id,
            "kind": kind,
            "semanticToken": semantic_token,
        }
        expected_rect = item.get("expectedRect")
        if isinstance(expected_rect, dict):
            try:
                x_norm = float(expected_rect.get("xNorm"))
                y_norm = float(expected_rect.get("yNorm"))
                w_norm = float(expected_rect.get("wNorm"))
                h_norm = float(expected_rect.get("hNorm"))
                if (
                    all(math.isfinite(number) for number in (x_norm, y_norm, w_norm, h_norm))
                    and x_norm >= 0
                    and y_norm >= 0
                    and w_norm > 0
                    and h_norm > 0
                    and x_norm + w_norm <= 1.0001
                    and y_norm + h_norm <= 1.0001
                ):
                    normalized["expectedRect"] = {
                        "xNorm": round(x_norm, 4),
                        "yNorm": round(y_norm, 4),
                        "wNorm": round(w_norm, 4),
                        "hNorm": round(h_norm, 4),
                    }
            except (TypeError, ValueError):
                pass
        checklist.append(normalized)
    return checklist


def _prompt_assistant_optimize_payload(request: dict) -> dict:
    source = request if isinstance(request, dict) else {}
    current_prompt = source.get("currentPrompt")
    if current_prompt is None:
        current_prompt = source.get("current_prompt")
    if current_prompt is None:
        current_prompt = source.get("prompt")
    payload = {
        "prompt": str(source.get("prompt") or ""),
        "negativePrompt": str(source.get("negativePrompt") or source.get("negative_prompt") or ""),
        "supportsNegativePrompt": source.get("supportsNegativePrompt") is not False,
        "nsfw": source.get("nsfw") is True,
        "purpose": str(source.get("purpose") or "").strip()[:80],
        "surface": str(source.get("surface") or "").strip()[:80],
        "requirements": str(source.get("requirements") or "").strip()[:12000],
        "currentPrompt": str(current_prompt or "").strip()[:20000],
        "provider": str(source.get("provider") or "local").strip()[:80],
    }
    requested_prompt_schema = str(
        source.get("promptSchema") or source.get("prompt_schema") or ""
    ).strip()
    if (
        payload["surface"] == "art"
        and payload["purpose"] == "optimize"
        and bool(payload["currentPrompt"])
        and requested_prompt_schema == "nf.art.prompt.v1"
    ):
        payload["promptSchema"] = requested_prompt_schema
        requested_detail_mode = str(
            source.get("promptDetailMode") or source.get("prompt_detail_mode") or ""
        ).strip()
        simple_source = payload["currentPrompt"]
        if (
            payload["provider"].strip().lower() == "local"
            and
            requested_detail_mode == "simple-structured-v1"
            and len(simple_source) <= 120
            and not re.search(r"[\r\n]", simple_source)
            and not re.search(r"__NOVAFLOW_[A-Z0-9_:-]+__", simple_source, re.I)
            and not re.search(r"@(?:参考图[1-9][0-9]*|视频参考|声音参考)", simple_source)
            and not re.search(r"\[[^\]\r\n]{1,32}\]|【[^】\r\n]{1,32}】", simple_source)
        ):
            payload["promptDetailMode"] = requested_detail_mode
    return payload


def _prompt_assistant_reverse_payload(request: dict) -> dict:
    source = request if isinstance(request, dict) else {}
    images = source.get("images") if isinstance(source.get("images"), list) else []
    purpose = str(source.get("purpose") or "").strip()[:80]
    normalized_purpose = purpose.lower().replace("_", "-")
    requirements_limit = 12000 if normalized_purpose in {
        "minimax-h3-i2v-reverse",
        "minimax-h3-fl2v-reverse",
    } else 2000
    provider = str(source.get("provider") or "local").strip().lower()
    if provider not in {"gpt", "google"}:
        provider = "local"
    current_prompt = str(
        source.get("currentPrompt")
        or source.get("current_prompt")
        or source.get("prompt")
        or ""
    ).strip()[:20000]
    preferred_output_language_value = str(source.get("preferredOutputLanguage") or "").strip().lower()
    preferred_output_language = (
        "en" if preferred_output_language_value == "en"
        else "zh-CN" if preferred_output_language_value == "zh-cn"
        else ""
    ) if normalized_purpose in {
        "minimax-h3-i2v-reverse",
        "minimax-h3-fl2v-reverse",
    } else ""
    mandatory_checklist = _normalize_prompt_assistant_mandatory_checklist(
        source.get("mandatoryChecklist")
    )
    payload = {
        "images": images[:3],
        "purpose": purpose,
        "currentPrompt": current_prompt,
        "requirements": str(source.get("requirements") or "").strip()[:requirements_limit],
        "surface": str(source.get("surface") or "").strip()[:80],
        "provider": provider,
        "mandatoryChecklist": mandatory_checklist,
        "mandatoryChecklistTokens": [
            item["checklistToken"] for item in mandatory_checklist
        ],
    }
    if preferred_output_language:
        payload["preferredOutputLanguage"] = preferred_output_language
    visual_schema = str(source.get("visualSchema") or "").strip()[:80]
    uses_minimax_h3_reverse = normalized_purpose in {
        "minimax-h3-i2v-reverse",
        "minimax-h3-fl2v-reverse",
    }
    if uses_minimax_h3_reverse and visual_schema != "nf.h3.visual.v1":
        raise ValueError("MiniMax H3 reverse requires visualSchema nf.h3.visual.v1")
    if uses_minimax_h3_reverse and (
        "userPrompt" not in source
        or not isinstance(source.get("userPrompt"), str)
        or "userRequirements" not in source
        or not isinstance(source.get("userRequirements"), str)
    ):
        raise ValueError(
            "MiniMax H3 reverse requires explicit userPrompt and userRequirements fields"
        )
    uses_minimax_h3_visual_v1 = uses_minimax_h3_reverse
    if uses_minimax_h3_visual_v1:
        source_policy = source.get("contentPolicy")
        source_policy = source_policy if isinstance(source_policy, dict) else {}
        payload["visualSchema"] = visual_schema
        payload["contentPolicy"] = {
            "sensitiveVisualAnalysis": source_policy.get("sensitiveVisualAnalysis") is True,
            "allSubjectsConfirmedAdult": source_policy.get("allSubjectsConfirmedAdult") is True,
        }
        payload["userPrompt"] = source["userPrompt"].strip()[:20000]
        payload["userRequirements"] = source["userRequirements"].strip()[:12000]
    if (
        payload["purpose"] == "static-image-reverse"
        and len(payload["images"]) == 1
        and visual_schema == "nf.visual.v2"
    ):
        payload["visualSchema"] = visual_schema
        payload["nsfw"] = source.get("nsfw") is True
    return payload


def _prompt_assistant_failure_metadata(value: dict | None) -> dict:
    direct = value if isinstance(value, dict) else {}
    nested = direct.get("failure") if isinstance(direct.get("failure"), dict) else {}
    source = {**direct, **nested}
    metadata: dict = {}

    def clean(field: str, max_length: int) -> str:
        return re.sub(
            r"\s+",
            " ",
            re.sub(r"[\x00-\x1f\x7f]+", " ", str(source.get(field) or "")),
        ).strip()[:max_length]

    for field, max_length in (
        ("errorCode", 80),
        ("message", 240),
        ("reverseProvider", 120),
        ("providerFailureCode", 80),
        ("requestedVisualSchema", 40),
        ("failureCategory", 48),
        ("failureClass", 80),
        ("generationGate", 32),
        ("applicationReason", 160),
        ("retentionReason", 160),
    ):
        text = clean(field, max_length)
        if text:
            metadata[field] = text
    for field in (
        "retryable",
        "retryAttempted",
        "legacyFallbackSuppressed",
        "sensitivePromptBlocked",
    ):
        if isinstance(source.get(field), bool):
            metadata[field] = source[field]
    retry_count = source.get("retryCount")
    if isinstance(retry_count, (int, float)) and not isinstance(retry_count, bool):
        metadata["retryCount"] = max(0, min(2, int(retry_count)))
    return metadata


def _is_prompt_assistant_static_image_reverse(command: str, payload: dict | None = None) -> bool:
    return (
        command == "reverseImagePrompt"
        and str((payload or {}).get("purpose") or "").strip() == "static-image-reverse"
    )


def _is_prompt_assistant_minimax_h3_reverse(command: str, payload: dict | None = None) -> bool:
    if command != "reverseImagePrompt":
        return False
    purpose = str((payload or {}).get("purpose") or "").strip().lower().replace("_", "-")
    return purpose in {"minimax-h3-i2v-reverse", "minimax-h3-fl2v-reverse"}


def _prompt_assistant_last_safe_h3_stage() -> str:
    with PROMPT_ASSISTANT_STDERR_LOCK:
        lines = list(PROMPT_ASSISTANT_STDERR_TAIL[-40:])
    for line in reversed(lines):
        try:
            payload = json.loads(str(line or ""))
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        event = str(payload.get("event") or "") if isinstance(payload, dict) else ""
        if event not in PROMPT_ASSISTANT_H3_STAGE_EVENTS:
            continue
        stage = re.sub(
            r"[^a-zA-Z0-9_.:-]+",
            "-",
            str(payload.get("stage") or payload.get("outcome") or event),
        ).strip("-")[:64]
        if stage:
            return stage
    return "none"


def _prompt_assistant_h3_timeout_envelope() -> dict:
    return {
        "errorCode": "h3-local-timeout",
        "failureCategory": "timeout",
        "retryable": True,
        "retryAttempted": False,
        "legacyFallbackSuppressed": True,
        "requestedVisualSchema": "nf.h3.visual.v1",
    }


def _trace_prompt_assistant_h3_lifecycle(event: str, metadata: dict | None = None) -> None:
    source = metadata if isinstance(metadata, dict) else {}
    purpose = re.sub(
        r"[^a-z0-9-]+", "", str(source.get("purpose") or "").lower().replace("_", "-")
    )[:40]
    last_safe_stage = re.sub(
        r"[^a-zA-Z0-9_.:-]+", "-", str(source.get("lastSafeStage") or "none")
    ).strip("-")[:64] or "none"
    stop_result = re.sub(
        r"[^a-zA-Z0-9_.:-]+", "-", str(source.get("stopResult") or "not-requested")
    ).strip("-")[:40] or "unknown"
    try:
        request_id = max(0, int(source.get("requestId") or 0))
    except (TypeError, ValueError):
        request_id = 0
    try:
        child_pid = max(0, int(source.get("childPid") or 0))
    except (TypeError, ValueError):
        child_pid = 0
    try:
        elapsed_ms = max(0, min(1_800_000, int(source.get("elapsedMs") or 0)))
    except (TypeError, ValueError):
        elapsed_ms = 0
    record = {
        "event": f"preview_prompt_assistant_h3_reverse_{event}",
        "purpose": purpose,
        "elapsedMs": elapsed_ms,
        "requestId": request_id,
        "childPid": child_pid,
        "lastSafeStage": last_safe_stage,
        "stopResult": stop_result,
    }
    if isinstance(source.get("ok"), bool):
        record["ok"] = source["ok"]
    print(json.dumps(record, ensure_ascii=True, separators=(",", ":")), file=sys.stderr, flush=True)


def _request_prompt_assistant(
    command: str,
    payload: dict | None = None,
    timeout: int = 300,
    *,
    lock_already_held: bool = False,
    deadline_monotonic: float | None = None,
) -> dict:
    global PROMPT_ASSISTANT_NEXT_REQUEST_ID, PROMPT_ASSISTANT_LAST_WARNING

    request_data = payload if isinstance(payload, dict) else {}
    static_image_reverse = _is_prompt_assistant_static_image_reverse(command, request_data)
    minimax_h3_reverse = _is_prompt_assistant_minimax_h3_reverse(command, request_data)
    config = _prompt_assistant_config()
    command_enabled = bool(config.get("serviceExists")) and bool(
        config.get("modelExists")
        or (static_image_reverse and config.get("reverseModelEnabled"))
    )
    if not command_enabled:
        if command == "reverseImagePrompt" and not static_image_reverse and not config.get("modelExists"):
            raise RuntimeError("当前反推模式需要 Qwen2.5-VL 旧模型，但该模型未配置")
        raise RuntimeError(str(config.get("error") or "Prompt Assistant 未配置"))
    if command == "reverseImagePrompt":
        PROMPT_ASSISTANT_LAST_WARNING = ""

    lock_context = contextlib.nullcontext() if lock_already_held else PROMPT_ASSISTANT_LOCK
    with lock_context:
        h3_trace_meta = None
        h3_cleanup_done = False
        started = None
        try:
            if deadline_monotonic is not None and time.monotonic() >= float(deadline_monotonic):
                raise TimeoutError("Prompt Assistant 总时限已耗尽")
            if deadline_monotonic is None and not lock_already_held:
                # Keep the established helper contract for every existing
                # surface; only the bounded ordinary-Art path needs ownership
                # and an absolute deadline propagated into startup.
                proc, out_queue = _ensure_prompt_assistant_process(
                    allow_reverse_only=static_image_reverse,
                )
            else:
                proc, out_queue = _ensure_prompt_assistant_process(
                    allow_reverse_only=static_image_reverse,
                    deadline_monotonic=deadline_monotonic,
                    caller_owns_cleanup=lock_already_held,
                )
            request_id = PROMPT_ASSISTANT_NEXT_REQUEST_ID
            PROMPT_ASSISTANT_NEXT_REQUEST_ID += 1
            request_payload = {"id": request_id, "command": command}
            request_payload.update(request_data)
            started = time.time()
            h3_trace_meta = {
                "purpose": str(request_data.get("purpose") or ""),
                "requestId": request_id,
                "childPid": getattr(proc, "pid", 0),
                "lastSafeStage": "none",
            } if minimax_h3_reverse else None
            if h3_trace_meta:
                _trace_prompt_assistant_h3_lifecycle("start", {
                    **h3_trace_meta,
                    "elapsedMs": int((time.time() - started) * 1000) if isinstance(started, (int, float)) else 0,
                    "stopResult": "not-requested",
                })
            trace_storyboard_director = command in {"storyboardDirectorPlan", "storyboardFinalShotPrompts"}
            if trace_storyboard_director:
                print(json.dumps({
                    "event": "preview_prompt_assistant_request_start",
                    "command": command,
                    "requestId": request_id,
                    "timeoutSeconds": max(10, int(timeout or 300)),
                    "storyChars": len(str(request_data.get("storyText") or "")),
                    "sourceAnalysisChars": len(str(request_data.get("sourceAnalysis") or "")),
                    "rulesChars": len(str(request_data.get("rules") or "")),
                }, ensure_ascii=False), file=sys.stderr, flush=True)
            try:
                if not proc.stdin:
                    raise RuntimeError("Prompt Assistant stdin 不可用")
                proc.stdin.write(json.dumps(request_payload, ensure_ascii=False) + "\n")
                proc.stdin.flush()
            except Exception:
                if not lock_already_held:
                    _stop_prompt_assistant_process()
                raise

            if deadline_monotonic is None:
                response_now = time.time
                deadline = response_now() + max(10, int(timeout or 300))
            else:
                response_now = time.monotonic
                deadline = min(
                    response_now() + max(1, int(timeout or 300)),
                    float(deadline_monotonic),
                )
            while response_now() < deadline:
                process_alive = _prompt_assistant_child_process_alive(proc)
                if process_alive is False:
                    detail = _prompt_assistant_stderr_text()
                    if not lock_already_held:
                        _stop_prompt_assistant_process()
                    raise RuntimeError(f"Prompt Assistant 服务已退出：{detail or proc.returncode}")
                if process_alive is None:
                    if not lock_already_held:
                        _stop_prompt_assistant_process()
                    raise PromptAssistantStartupError(
                        "Prompt Assistant 进程状态无法确认，请重试",
                        "prompt-assistant-process-state-indeterminate",
                    )
                try:
                    remaining = max(0.0, deadline - response_now())
                    if remaining <= 0:
                        break
                    line = out_queue.get(timeout=min(0.5, remaining))
                except queue.Empty:
                    continue
                if line is None:
                    continue
                try:
                    message = json.loads(str(line).strip())
                except Exception:
                    continue
                if message.get("id") != request_id:
                    continue
                result_data = message.get("data") if isinstance(message.get("data"), dict) else {}
                if static_image_reverse:
                    fallback_reason = re.sub(
                        r"[\x00-\x1f\x7f]+", " ", str(result_data.get("reverseFallbackReason") or "")
                    ).strip()[:120]
                    reverse_provider = re.sub(
                        r"[\x00-\x1f\x7f]+", " ", str(result_data.get("reverseProvider") or "legacy")
                    ).strip()[:120] or "legacy"
                    PROMPT_ASSISTANT_LAST_WARNING = (
                        f"图片反推已回退到 {reverse_provider}：{fallback_reason}"
                        if fallback_reason else ""
                    )
                    message["warning"] = PROMPT_ASSISTANT_LAST_WARNING
                if trace_storyboard_director:
                    print(json.dumps({
                        "event": "preview_prompt_assistant_request_done",
                        "command": command,
                        "requestId": request_id,
                        "ok": bool(message.get("ok")),
                        "elapsedSeconds": round(time.time() - started, 2),
                    }, ensure_ascii=False), file=sys.stderr, flush=True)
                if h3_trace_meta:
                    stop_result = _stop_prompt_assistant_process()
                    h3_cleanup_done = True
                    _trace_prompt_assistant_h3_lifecycle("done", {
                        **h3_trace_meta,
                        "elapsedMs": int((time.time() - started) * 1000),
                        "lastSafeStage": _prompt_assistant_last_safe_h3_stage(),
                        "stopResult": stop_result,
                        "ok": bool(message.get("ok")),
                    })
                return message

            if trace_storyboard_director:
                print(json.dumps({
                    "event": "preview_prompt_assistant_request_timeout",
                    "command": command,
                    "requestId": request_id,
                    "elapsedSeconds": round(time.time() - started, 2),
                    "childMayStillBeGenerating": True,
                    "recovery": "restart_prompt_assistant_after_timeout",
                }, ensure_ascii=False), file=sys.stderr, flush=True)
            if h3_trace_meta:
                stop_result = _stop_prompt_assistant_process()
                h3_cleanup_done = True
                _trace_prompt_assistant_h3_lifecycle("timeout", {
                    **h3_trace_meta,
                    "elapsedMs": int((time.time() - started) * 1000),
                    "lastSafeStage": _prompt_assistant_last_safe_h3_stage(),
                    "stopResult": stop_result,
                })
                return {
                    "ok": False,
                    "error": "MiniMax H3 local reverse timed out",
                    **_prompt_assistant_h3_timeout_envelope(),
                }
            if not lock_already_held:
                _stop_prompt_assistant_process()
            raise TimeoutError("Prompt Assistant 推理超时")
        except Exception:
            if minimax_h3_reverse:
                stop_result = _stop_prompt_assistant_process()
                h3_cleanup_done = True
                _trace_prompt_assistant_h3_lifecycle("done", {
                    **(h3_trace_meta or {
                        "purpose": str(request_data.get("purpose") or ""),
                        "requestId": 0,
                        "childPid": 0,
                    }),
                    "elapsedMs": int((time.time() - started) * 1000) if isinstance(started, (int, float)) else 0,
                    "lastSafeStage": _prompt_assistant_last_safe_h3_stage(),
                    "stopResult": stop_result,
                    "ok": False,
                })
            raise
        finally:
            if static_image_reverse or (minimax_h3_reverse and not h3_cleanup_done):
                _stop_prompt_assistant_process()


def _append_aifx_debug_log(summary: dict, request_dir: Path) -> None:
    DEBUG_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d %H:%M")
    best_id = summary.get("bestCandidateId")
    candidates = summary.get("candidates") or []
    best = next((item for item in candidates if item.get("id") == best_id), candidates[0] if candidates else {})
    metrics = best.get("metrics") or {}
    prompt_variant_assessment = summary.get("promptVariantAssessment") or {}
    with DEBUG_LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(
            f"\n[{stamp}]\n"
            f"- 问题：AI 特效主流程需要接入已验证的候选式生命周期重混 pipeline。\n"
            f"- 原因：renderer 不能直接执行 Python；旧 material/sprite/img2img/VACE raw 链路不能再作为主流程 fallback。\n"
            f"- 解决方案：pipeline={AIFX_PIPELINE}; template={summary.get('template')}; "
            f"reference={summary.get('referenceImage')}; inferredEffectType={summary.get('inferredEffectType')}; "
            f"candidateCount={summary.get('candidateCount')}; bestIndex={best_id}; "
            f"lifecycle_pass={metrics.get('lifecycle_pass')}; direction_pass={metrics.get('direction_pass')}; "
            f"texture_quality={metrics.get('texture_quality')}; "
            f"promptVariantAssessment={prompt_variant_assessment.get('message')}; requestDir={request_dir}\n"
            f"- 影响范围：4783 AI 特效产品接入桥接与 AI 特效生成按钮；不影响 AI 动画、粒子特效、拆图、Spine 或旧验证脚本。\n"
        )


def _align_vace_dimension(value: int, step: int = 64) -> int:
    return max(step, ((max(1, int(value)) + step - 1) // step) * step)


class PreviewRuntimeHandler(SimpleHTTPRequestHandler):
    server_version = "NovaFlowPreview/1.0"

    def __init__(self, *args, directory: str, default_base_url: str, **kwargs):
        self._default_base_url = default_base_url
        super().__init__(*args, directory=directory, **kwargs)

    def end_headers(self) -> None:
        self._send_preview_cache_headers()
        super().end_headers()

    def do_GET(self) -> None:
        if self.path.startswith(AI_SEQUENCE_H3_OUTPUT_PATH):
            self._handle_ai_sequence_h3_output_view()
            return
        if self.path.startswith(HEALTH_PATH):
            self._handle_health()
            return
        if self.path.startswith(PROMPT_ASSISTANT_PATH):
            self._handle_prompt_assistant()
            return
        if self.path.startswith(MOUSE_POSITION_PATH):
            self._handle_mouse_position()
            return
        if self.path.startswith(PROXY_PREFIX):
            self._handle_proxy()
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if self.path.startswith(AI_SEQUENCE_H3_OUTPUT_PATH):
            self._handle_ai_sequence_h3_output_view(send_body=False)
            return
        if self.path.startswith(HEALTH_PATH):
            self._handle_health(send_body=False)
            return
        if self.path.startswith(PROMPT_ASSISTANT_PATH):
            self._handle_prompt_assistant(send_body=False)
            return
        if self.path.startswith(MOUSE_POSITION_PATH):
            self._handle_mouse_position(send_body=False)
            return
        if self.path.startswith(PROXY_PREFIX):
            self._handle_proxy(send_body=False)
            return
        super().do_HEAD()

    def do_POST(self) -> None:
        if self.path.startswith(AI_SEQUENCE_H3_OUTPUT_PATH):
            self._handle_ai_sequence_h3_output()
            return
        if self.path.startswith(AI_SEQUENCE_LORA_PATH):
            self._handle_ai_sequence_lora()
            return
        if self.path.startswith(PROMPT_ASSISTANT_PATH):
            self._handle_prompt_assistant()
            return
        if self.path.startswith(AIFX_PIPELINE_PATH):
            self._handle_aifx_spritesheet_conditioned_regen()
            return
        if self.path.startswith(PROXY_PREFIX):
            self._handle_proxy()
            return
        self.send_error(405, "Method Not Allowed")

    def do_PUT(self) -> None:
        if self.path.startswith(PROXY_PREFIX):
            self._handle_proxy()
            return
        self.send_error(405, "Method Not Allowed")

    def do_DELETE(self) -> None:
        if self.path.startswith(PROXY_PREFIX):
            self._handle_proxy()
            return
        self.send_error(405, "Method Not Allowed")

    def do_OPTIONS(self) -> None:
        if self.path.startswith(AI_SEQUENCE_H3_OUTPUT_PATH):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
            self.end_headers()
            return
        if self.path.startswith(AI_SEQUENCE_LORA_PATH):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.end_headers()
            return
        if self.path.startswith(PROMPT_ASSISTANT_PATH):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
            self.end_headers()
            return
        if self.path.startswith(MOUSE_POSITION_PATH):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            self.end_headers()
            return
        if self.path.startswith(AIFX_PIPELINE_PATH):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.end_headers()
            return
        if self.path.startswith(PROXY_PREFIX):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, x-runtime-base")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            self.end_headers()
            return
        super().do_OPTIONS()

    def log_message(self, format: str, *args) -> None:
        return

    def _send_preview_cache_headers(self) -> None:
        buffered = b"".join(getattr(self, "_headers_buffer", [])).lower()
        if b"cache-control:" not in buffered:
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        if b"pragma:" not in buffered:
            self.send_header("Pragma", "no-cache")
        if b"expires:" not in buffered:
            self.send_header("Expires", "0")

    def _build_target_url(self) -> str:
        base_url = self._resolve_proxy_base_url()
        suffix = self.path[len(PROXY_PREFIX):] or "/"
        if not suffix.startswith("/"):
            suffix = f"/{suffix}"
        return f"{base_url}{suffix}"

    def _build_health_target_url(self) -> str:
        base_url = self._resolve_proxy_base_url()
        return f"{base_url}/"

    def _resolve_proxy_base_url(self) -> str:
        return normalize_base_url(self.headers.get("x-runtime-base") or self._default_base_url)

    def _proxy_headers(self, base_url: str) -> dict[str, str]:
        headers: dict[str, str] = {}
        for key, value in self.headers.items():
            if key.lower() in HOP_BY_HOP_HEADERS:
                continue
            if key.lower() == "x-runtime-base":
                continue
            headers[key] = value
        parsed = urlsplit(base_url)
        if parsed.scheme and parsed.netloc:
            origin = f"{parsed.scheme}://{parsed.netloc}"
            headers["Origin"] = origin
            headers["Referer"] = f"{base_url.rstrip('/')}/"
        return headers

    def _read_request_body(self) -> bytes | None:
        length = self.headers.get("Content-Length")
        if not length:
            return None
        try:
            size = int(length)
        except ValueError:
            return None
        if size <= 0:
            return None
        return self.rfile.read(size)

    def _handle_proxy(self, send_body: bool = True) -> None:
        target_url = self._build_target_url()
        body = self._read_request_body()
        if (
            self.command.upper() == "POST"
            and is_runtime_prompt_path(self.path)
            and is_legacy_aifx_prompt_body(body)
        ):
            payload = b'{"ok":false,"blocked":true,"reason":"legacy_aifx_runtime_prompt_disabled"}'
            headers = {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}
            self._write_proxy_response(409, headers, payload if send_body else b"")
            return
        paid_image_block = preview_paid_image_provider_block_reason(self.path, self.command, body)
        if paid_image_block:
            payload = _json_bytes({"ok": False, "blocked": True, "reason": paid_image_block})
            headers = {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}
            self._write_proxy_response(403, headers, payload if send_body else b"")
            return
        body = inject_comfy_api_credentials_into_prompt_body(self.path, self.command, body)
        base_url = self._resolve_proxy_base_url()
        req = Request(
            target_url,
            data=body,
            headers=self._proxy_headers(base_url),
            method=self.command,
        )
        try:
            with urlopen(req, timeout=10) as resp:
                payload = resp.read() if send_body else b""
                self._write_proxy_response(resp.status, resp.headers, payload)
        except HTTPError as exc:
            payload = exc.read() if send_body else b""
            self._write_proxy_response(exc.code, exc.headers, payload)
        except URLError as exc:
            self._write_text_error(502, f"Proxy request failed: {exc.reason}")
        except Exception as exc:  # pragma: no cover
            self._write_text_error(500, f"Unexpected proxy failure: {exc}")

    def _handle_mouse_position(self, send_body: bool = True) -> None:
        payload = _get_system_mouse_position()
        if send_body:
            self._write_json_response(200 if payload.get("ok") else 503, payload)
            return
        self.send_response(200 if payload.get("ok") else 503)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    @staticmethod
    def _h3_output_payload_contains_forbidden_path(value: object) -> bool:
        forbidden_keys = {
            "path",
            "root",
            "sourcepath",
            "outputpath",
            "absolutepath",
            "localpath",
            "warehousepath",
            "warehousedir",
            "runtimeconfigpath",
        }
        if isinstance(value, dict):
            for key, nested in value.items():
                if str(key).replace("_", "").lower() in forbidden_keys:
                    return True
                if PreviewRuntimeHandler._h3_output_payload_contains_forbidden_path(nested):
                    return True
        elif isinstance(value, list):
            return any(PreviewRuntimeHandler._h3_output_payload_contains_forbidden_path(item) for item in value)
        return False

    @staticmethod
    def _sanitize_h3_output_item(item: object) -> dict:
        if not isinstance(item, dict):
            return {}
        hidden_keys = {
            "path",
            "sourcePath",
            "outputPath",
            "absolutePath",
            "localPath",
            "warehousePath",
            "warehouseDir",
            "runtimeConfigPath",
        }
        clean = {key: value for key, value in item.items() if key not in hidden_keys}
        item_id = str(clean.get("id") or "").strip()
        if item_id:
            view_url = f"{AI_SEQUENCE_H3_OUTPUT_PATH}/view?id={quote(item_id, safe='')}"
            clean["viewUrl"] = view_url
            clean["objectUrl"] = view_url
        return clean

    def _run_ai_sequence_h3_output_publisher(self, action: str, payload: dict | None = None, item_id: str = "") -> tuple[int, dict]:
        node_executable = shutil.which("node")
        if not node_executable or not AI_SEQUENCE_H3_OUTPUT_PUBLISHER.is_file():
            return 503, {"ok": False, "error": "h3_output_publisher_unavailable", "preview": True}
        request = {"action": action}
        if payload is not None:
            request["payload"] = payload
        if item_id:
            request["id"] = item_id
        env = dict(os.environ)
        env["NOVAFLOW_H3_OUTPUT_PUBLISHER"] = str(AI_SEQUENCE_H3_OUTPUT_PUBLISHER)
        env["NOVAFLOW_H3_RUNTIME_JSON"] = str(AI_SEQUENCE_H3_RUNTIME_JSON)
        env["NOVAFLOW_H3_WAREHOUSE_DIR"] = str(AI_SEQUENCE_H3_WAREHOUSE_DIR)
        try:
            completed = subprocess.run(
                [node_executable, "-e", AI_SEQUENCE_H3_OUTPUT_NODE_RUNNER],
                input=json.dumps(request, ensure_ascii=False),
                text=True,
                encoding="utf-8",
                capture_output=True,
                timeout=AI_SEQUENCE_H3_OUTPUT_TIMEOUT_SEC,
                cwd=str(AI_SEQUENCE_H3_OUTPUT_PUBLISHER.parent.parent),
                check=False,
                creationflags=AI_SEQUENCE_H3_OUTPUT_CREATION_FLAGS,
                env=env,
            )
        except subprocess.TimeoutExpired:
            return 504, {"ok": False, "error": "h3_output_publisher_timeout", "preview": True}
        except Exception as exc:
            return 503, {"ok": False, "error": f"h3_output_publisher_failed: {exc}", "preview": True}
        try:
            response = json.loads(str(completed.stdout or "").lstrip("\ufeff") or "{}")
        except Exception:
            response = {"ok": False, "error": "h3_output_publisher_invalid_response"}
        if not isinstance(response, dict):
            response = {"ok": False, "error": "h3_output_publisher_invalid_response"}
        response["preview"] = True
        return (200 if completed.returncode == 0 and response.get("ok") is not False else 503), response

    def _handle_ai_sequence_h3_output(self) -> None:
        try:
            if not ipaddress.ip_address(str(self.client_address[0])).is_loopback:
                self._write_json_response(403, {"ok": False, "error": "loopback_only", "preview": True})
                return
        except ValueError:
            self._write_json_response(403, {"ok": False, "error": "loopback_only", "preview": True})
            return
        clean_path = self.path.split("?", 1)[0].rstrip("/")
        if clean_path != AI_SEQUENCE_H3_OUTPUT_PATH:
            self._write_json_response(404, {"ok": False, "error": "unknown_h3_output_path", "preview": True})
            return
        try:
            content_length = int(str(self.headers.get("Content-Length") or "0").strip())
        except ValueError:
            content_length = -1
        if content_length < 0 or content_length > AI_SEQUENCE_H3_OUTPUT_MAX_BODY_BYTES:
            self._write_json_response(413, {"ok": False, "error": "request_too_large", "preview": True})
            return
        body = self._read_request_body() or b"{}"
        try:
            request = json.loads(body.decode("utf-8-sig"))
        except Exception:
            self._write_json_response(400, {"ok": False, "error": "invalid_json", "preview": True})
            return
        if not isinstance(request, dict):
            self._write_json_response(400, {"ok": False, "error": "invalid_request", "preview": True})
            return
        action = str(request.get("action") or "").strip().lower()
        raw_payload = request.get("payload", {})
        payload = raw_payload if isinstance(raw_payload, dict) else {}
        if action not in AI_SEQUENCE_H3_OUTPUT_ACTIONS:
            self._write_json_response(400, {"ok": False, "error": "unsupported_action", "preview": True})
            return
        if self._h3_output_payload_contains_forbidden_path(payload):
            self._write_json_response(400, {"ok": False, "error": "path_fields_forbidden", "preview": True})
            return
        if action == "publish":
            payload, payload_error = _normalize_ai_sequence_h3_output_publish_payload(raw_payload)
            if payload is None:
                self._write_json_response(400, {"ok": False, "error": payload_error, "preview": True})
                return
        else:
            payload = {}
        status, response = self._run_ai_sequence_h3_output_publisher(action, payload)
        if response.get("ok") is not False:
            if action == "publish":
                response["item"] = self._sanitize_h3_output_item(response.get("item"))
            else:
                response["items"] = [
                    self._sanitize_h3_output_item(item)
                    for item in (response.get("items") if isinstance(response.get("items"), list) else [])
                ]
        self._write_json_response(status, response)

    def _handle_ai_sequence_h3_output_view(self, send_body: bool = True) -> None:
        try:
            if not ipaddress.ip_address(str(self.client_address[0])).is_loopback:
                self._write_json_response(403, {"ok": False, "error": "loopback_only", "preview": True})
                return
        except ValueError:
            self._write_json_response(403, {"ok": False, "error": "loopback_only", "preview": True})
            return
        parsed = urlsplit(self.path)
        if parsed.path.rstrip("/") != f"{AI_SEQUENCE_H3_OUTPUT_PATH}/view":
            self._write_json_response(404, {"ok": False, "error": "unknown_h3_output_path", "preview": True})
            return
        query = parse_qs(parsed.query, keep_blank_values=True)
        item_id = str((query.get("id") or [""])[0]).strip()
        if (
            set(query) != {"id"}
            or len(query.get("id") or []) != 1
            or not item_id
            or len(item_id) > 2048
            or any(character in item_id for character in "\0\r\n")
        ):
            self._write_json_response(400, {"ok": False, "error": "invalid_resource_id", "preview": True})
            return
        status, resolved = self._run_ai_sequence_h3_output_publisher("resolve", item_id=item_id)
        target_value = resolved.get("path") if isinstance(resolved, dict) else ""
        if not target_value:
            missing_status = status if resolved.get("error") else 404
            self._write_json_response(missing_status, {"ok": False, "error": "resource_not_found", "preview": True})
            return
        try:
            warehouse_root = AI_SEQUENCE_H3_WAREHOUSE_DIR.resolve(strict=True)
            target = Path(str(target_value or "")).resolve(strict=True)
            if os.path.commonpath([str(warehouse_root), str(target)]) != str(warehouse_root) or not target.is_file():
                raise ValueError("resource_outside_warehouse")
        except Exception:
            self._write_json_response(404, {"ok": False, "error": "resource_not_found", "preview": True})
            return
        file_size = target.stat().st_size
        range_header = str(self.headers.get("Range") or "").strip()
        start, end = 0, max(0, file_size - 1)
        response_status = 200
        if range_header:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header)
            if not match or file_size <= 0:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{file_size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            first, last = match.groups()
            if first:
                start = int(first)
                end = min(int(last), file_size - 1) if last else file_size - 1
            else:
                suffix_length = min(int(last or "0"), file_size)
                start, end = file_size - suffix_length, file_size - 1
            if start < 0 or start >= file_size or end < start:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{file_size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            response_status = 206
        content_length = max(0, end - start + 1)
        self.send_response(response_status)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Accept-Ranges", "bytes")
        if response_status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.send_header("Content-Length", str(content_length))
        self.end_headers()
        if not send_body or content_length <= 0:
            return
        with target.open("rb") as handle:
            handle.seek(start)
            remaining = content_length
            while remaining > 0:
                chunk = handle.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def _handle_ai_sequence_lora(self) -> None:
        try:
            if not ipaddress.ip_address(str(self.client_address[0])).is_loopback:
                self._write_json_response(403, {"ok": False, "error": "loopback_only", "preview": True})
                return
        except ValueError:
            self._write_json_response(403, {"ok": False, "error": "loopback_only", "preview": True})
            return
        clean_path = self.path.split("?", 1)[0].rstrip("/")
        if clean_path != AI_SEQUENCE_LORA_PATH:
            self._write_json_response(404, {"ok": False, "error": "unknown_lora_bridge_path", "preview": True})
            return
        raw_length = str(self.headers.get("Content-Length") or "0").strip()
        try:
            content_length = int(raw_length)
        except ValueError:
            content_length = -1
        if content_length < 0 or content_length > AI_SEQUENCE_LORA_MAX_BODY_BYTES:
            self._write_json_response(413, {"ok": False, "error": "request_too_large", "preview": True})
            return
        body = self._read_request_body() or b"{}"
        try:
            request = json.loads(body.decode("utf-8-sig"))
        except Exception:
            self._write_json_response(400, {"ok": False, "error": "invalid_json", "preview": True})
            return
        if not isinstance(request, dict):
            self._write_json_response(400, {"ok": False, "error": "invalid_request", "preview": True})
            return
        node_executable = shutil.which("node")
        if not node_executable or not AI_SEQUENCE_LORA_BRIDGE.is_file():
            self._write_json_response(503, {"ok": False, "error": "lora_bridge_unavailable", "preview": True})
            return
        try:
            completed = subprocess.run(
                [node_executable, str(AI_SEQUENCE_LORA_BRIDGE)],
                input=json.dumps(request, ensure_ascii=False),
                text=True,
                encoding="utf-8",
                capture_output=True,
                timeout=AI_SEQUENCE_LORA_TIMEOUT_SEC,
                cwd=str(AI_SEQUENCE_LORA_BRIDGE.parent.parent),
                check=False,
                creationflags=AI_SEQUENCE_LORA_CREATION_FLAGS,
            )
        except subprocess.TimeoutExpired:
            self._write_json_response(504, {"ok": False, "error": "lora_bridge_timeout", "preview": True})
            return
        except Exception as exc:
            self._write_json_response(503, {"ok": False, "error": f"lora_bridge_failed: {exc}", "preview": True})
            return
        try:
            response = json.loads(str(completed.stdout or "").lstrip("\ufeff") or "{}")
        except Exception:
            response = {"ok": False, "error": "lora_bridge_invalid_response"}
        if not isinstance(response, dict):
            response = {"ok": False, "error": "lora_bridge_invalid_response"}
        response["preview"] = True
        status = 200 if completed.returncode == 0 else 503
        self._write_json_response(status, response)

    def _handle_prompt_assistant(self, send_body: bool = True) -> None:
        optimize_started = time.monotonic()
        suffix = self.path[len(PROMPT_ASSISTANT_PATH):].split("?", 1)[0].rstrip("/") or "/status"
        body = self._read_request_body()
        try:
            request = json.loads((body or b"{}").decode("utf-8-sig")) if body else {}
        except Exception as exc:
            self._write_json_response(400, {"ok": False, "error": f"无效请求：{exc}", "preview": True})
            return

        if suffix in {"/", "/status", "/get-status"}:
            payload = _prompt_assistant_config()
            payload["preview"] = True
            available = bool(payload.get("enabled") or payload.get("reverseModelEnabled"))
            if send_body:
                self._write_json_response(200 if available else 503, payload)
            else:
                self.send_response(200 if available else 503)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", "0")
                self.end_headers()
            return

        if not send_body:
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        ordinary_art_prompt_patch = False
        ordinary_art_lock_acquired = False
        ordinary_art_deadline = None
        ordinary_art_inference_deadline = None
        resource_handoff = None
        try:
            if suffix in {"/optimize", "/optimize-prompt"}:
                optimize_payload = _prompt_assistant_optimize_payload(request)
                ordinary_art_prompt_patch = _is_ordinary_local_art_prompt_patch(optimize_payload)
                optimize_timeout = 300
                if ordinary_art_prompt_patch:
                    ordinary_art_deadline = optimize_started + 300.0
                    ordinary_art_inference_deadline = ordinary_art_deadline - 5.5
                    ordinary_art_lock_acquired = PROMPT_ASSISTANT_LOCK.acquire(blocking=False)
                    if not ordinary_art_lock_acquired:
                        _trace_prompt_assistant_ordinary_art_patch("busy", {
                            "elapsedMs": int((time.monotonic() - optimize_started) * 1000),
                            "errorCode": "prompt-assistant-busy",
                            "ok": False,
                        })
                        self._write_json_response(
                            409,
                            {
                                "ok": False,
                                "error": "Prompt Assistant 正在处理另一个任务，请稍后重试",
                                "errorCode": "prompt-assistant-busy",
                                "retryable": True,
                                "runtimeStatus": "推理中",
                                "preview": True,
                            },
                        )
                        return
                    _trace_prompt_assistant_ordinary_art_patch("resource-handoff-start", {"elapsedMs": 0})
                    resource_handoff = _prepare_prompt_assistant_resource_handoff(
                        normalize_base_url(self._default_base_url)
                    )
                    _trace_prompt_assistant_ordinary_art_patch("resource-handoff-done", {
                        "elapsedMs": int((time.monotonic() - optimize_started) * 1000),
                        "runtimeState": resource_handoff.get("state"),
                        "running": resource_handoff.get("running"),
                        "pending": resource_handoff.get("pending"),
                        "released": resource_handoff.get("released"),
                        "errorCode": resource_handoff.get("errorCode"),
                        "ok": resource_handoff.get("ok") is not False,
                    })
                    if resource_handoff.get("ok") is False:
                        busy = resource_handoff.get("state") == "runtime-generation-busy"
                        self._write_json_response(
                            409 if busy else 503,
                            {
                                "ok": False,
                                "error": str(resource_handoff.get("error") or "绘图模型资源交接失败"),
                                "errorCode": str(
                                    resource_handoff.get("errorCode") or "runtime-resource-handoff-failed"
                                ),
                                "retryable": True,
                                "runtimeStatus": "绘图生成中" if busy else "显存交接失败",
                                "resourceHandoff": resource_handoff,
                                "preview": True,
                            },
                        )
                        return
                    # Child startup may consume up to 12 s. Keep that startup
                    # and the verified 5 s cleanup inside the one absolute
                    # 300 s handler budget.
                    remaining_seconds = 300 - (time.monotonic() - optimize_started) - 18.5
                    if remaining_seconds < 10:
                        self._write_json_response(
                            504,
                            {
                                "ok": False,
                                "error": "Prompt Assistant 资源交接后剩余推理时间不足，请重试",
                                "errorCode": "ordinary-art-prompt-patch-deadline-exhausted",
                                "retryable": True,
                                "runtimeStatus": "推理超时",
                                "resourceHandoff": resource_handoff,
                                "preview": True,
                            },
                        )
                        return
                    optimize_timeout = max(10, int(remaining_seconds))
                    _trace_prompt_assistant_ordinary_art_patch("inference-start", {
                        "elapsedMs": int((time.monotonic() - optimize_started) * 1000),
                        "runtimeState": resource_handoff.get("state"),
                        "released": resource_handoff.get("released"),
                        "ok": True,
                    })
                try:
                    message = _request_prompt_assistant(
                        "optimizePrompt",
                        optimize_payload,
                        timeout=optimize_timeout,
                        lock_already_held=ordinary_art_prompt_patch,
                        deadline_monotonic=ordinary_art_inference_deadline,
                    )
                finally:
                    if ordinary_art_prompt_patch:
                        stop_result = _stop_prompt_assistant_process()
                        _trace_prompt_assistant_ordinary_art_patch("cleanup-done", {
                            "elapsedMs": int((time.monotonic() - optimize_started) * 1000),
                            "runtimeState": (resource_handoff or {}).get("state"),
                            "released": (resource_handoff or {}).get("released"),
                            "errorCode": "prompt-assistant-stop-timeout" if stop_result == "stop-timeout" else "",
                            "ok": stop_result != "stop-timeout",
                        })
                if resource_handoff is not None:
                    message["resourceHandoff"] = resource_handoff
                if ordinary_art_prompt_patch and stop_result == "stop-timeout":
                    message = {
                        "ok": False,
                        "error": "Prompt Assistant 推理已结束，但模型进程未能确认退出，请重试",
                        "errorCode": "prompt-assistant-stop-timeout",
                        "failureCategory": "resource_cleanup",
                        "retryable": True,
                        "resourceHandoff": resource_handoff,
                    }
            elif suffix in {"/storyboard-director-plan", "/storyboard-director"}:
                message = _request_prompt_assistant(
                    "storyboardDirectorPlan",
                    {
                        "storyText": str(request.get("storyText") or ""),
                        "sourceAnalysis": str(request.get("sourceAnalysis") or ""),
                        "visualCuePack": str(request.get("visualCuePack") or ""),
                        "rules": str(request.get("rules") or ""),
                        "selectedStoryDirection": request.get("selectedStoryDirection"),
                        "visualEventChain": request.get("visualEventChain"),
                    },
                    timeout=120,
                )
            elif suffix in {"/storyboard-story-directions", "/storyboard-directions"}:
                message = _request_prompt_assistant(
                    "storyboardStoryDirections",
                    {
                        "storyText": str(request.get("storyText") or ""),
                        "sourceAnalysis": str(request.get("sourceAnalysis") or ""),
                        "storyDirectionSeed": str(request.get("storyDirectionSeed") or ""),
                    },
                    timeout=120,
                )
            elif suffix in {"/storyboard-final-shot-prompts", "/storyboard-final-shots"}:
                message = _request_prompt_assistant(
                    "storyboardFinalShotPrompts",
                    {
                        "storyText": str(request.get("storyText") or ""),
                        "sourceAnalysis": str(request.get("sourceAnalysis") or ""),
                        "visualCuePack": str(request.get("visualCuePack") or ""),
                        "selectedStoryDirection": request.get("selectedStoryDirection"),
                        "visualEventChain": request.get("visualEventChain"),
                        "finalShotSeed": str(request.get("finalShotSeed") or ""),
                    },
                    timeout=300,
                )
            elif suffix in {"/storyboard-unified-nine-shots", "/storyboard-unified"}:
                message = _request_prompt_assistant(
                    "storyboardUnifiedNineShots",
                    {
                        "storyText": str(request.get("storyText") or ""),
                        "sourceAnalysis": str(request.get("sourceAnalysis") or ""),
                        "visualCuePack": str(request.get("visualCuePack") or ""),
                        "unifiedSeed": str(request.get("unifiedSeed") or ""),
                    },
                    timeout=300,
                )
            elif suffix in {"/storyboard-visual-event-chain", "/storyboard-events"}:
                message = _request_prompt_assistant(
                    "storyboardVisualEventChain",
                    {
                        "storyText": str(request.get("storyText") or ""),
                        "sourceAnalysis": str(request.get("sourceAnalysis") or ""),
                        "visualCuePack": str(request.get("visualCuePack") or ""),
                        "selectedStoryDirection": request.get("selectedStoryDirection"),
                        "visualEventSeed": str(request.get("visualEventSeed") or ""),
                    },
                    timeout=300,
                )
            elif suffix in {"/reverse", "/reverse-image-prompt"}:
                raw_h3_reverse = _is_prompt_assistant_minimax_h3_reverse(
                    "reverseImagePrompt", request
                )
                try:
                    reverse_payload = _prompt_assistant_reverse_payload(request)
                    message = _request_prompt_assistant(
                        "reverseImagePrompt",
                        reverse_payload,
                        timeout=180 if _is_prompt_assistant_minimax_h3_reverse(
                            "reverseImagePrompt", reverse_payload
                        ) else 300,
                    )
                finally:
                    if raw_h3_reverse:
                        with PROMPT_ASSISTANT_LOCK:
                            _stop_prompt_assistant_process()
            else:
                self._write_json_response(404, {"ok": False, "error": "未知 Prompt Assistant 端点", "preview": True})
                return

            if message.get("ok"):
                self._write_json_response(
                    200,
                    {
                        "ok": True,
                        "data": message.get("data") or {},
                        "runtimeStatus": "模型可用",
                        "warning": str(message.get("warning") or ""),
                        **({"resourceHandoff": message.get("resourceHandoff")}
                           if isinstance(message.get("resourceHandoff"), dict) else {}),
                        "preview": True,
                    },
                )
                return

            self._write_json_response(
                500,
                {
                    "ok": False,
                    "error": message.get("error") or "Prompt Assistant 推理失败",
                    "runtimeStatus": "推理失败",
                    "status": message.get("status"),
                    **({"resourceHandoff": message.get("resourceHandoff")}
                       if isinstance(message.get("resourceHandoff"), dict) else {}),
                    "preview": True,
                    **_prompt_assistant_failure_metadata(message),
                },
            )
        except Exception as exc:
            startup_error_code = str(getattr(exc, "error_code", "") or "")[:80]
            self._write_json_response(
                500,
                {
                    "ok": False,
                    "error": str(exc),
                    "runtimeStatus": "推理失败",
                    "stderr": _prompt_assistant_stderr_text(),
                    **({"resourceHandoff": resource_handoff}
                       if isinstance(resource_handoff, dict) else {}),
                    **({
                        "errorCode": startup_error_code,
                        "failureCategory": "resource_busy",
                        "retryable": bool(getattr(exc, "retryable", True)),
                    } if startup_error_code else {}),
                    "preview": True,
                },
            )
        finally:
            if ordinary_art_lock_acquired:
                PROMPT_ASSISTANT_LOCK.release()

    def _handle_health(self, send_body: bool = True) -> None:
        target_url = self._build_health_target_url()
        req = Request(target_url, headers={"Accept": "text/html,application/json;q=0.9,*/*;q=0.8"}, method="GET")
        try:
            with urlopen(req, timeout=1.2) as resp:
                payload = b'{"ok":true}' if send_body else b""
                headers = {"Content-Type": "application/json; charset=utf-8"}
                self._write_proxy_response(200 if resp.status < 500 else resp.status, headers, payload)
        except HTTPError as exc:
            if exc.code < 500:
                payload = b'{"ok":true}' if send_body else b""
                headers = {"Content-Type": "application/json; charset=utf-8"}
                self._write_proxy_response(200, headers, payload)
                return
            self._write_text_error(502, f"Health check failed: HTTP {exc.code}")
        except URLError as exc:
            self._write_text_error(502, f"Health check failed: {exc.reason}")
        except Exception as exc:  # pragma: no cover
            self._write_text_error(500, f"Unexpected health failure: {exc}")

    def _handle_aifx_spritesheet_conditioned_regen(self) -> None:
        if not AIFX_LOCK.acquire(blocking=False):
            self._write_json_response(
                409,
                {
                    "ok": False,
                    "pipeline": AIFX_PIPELINE,
                    "error": "AIFX pipeline is already running. Please wait for the current generation to finish.",
                },
            )
            return
        try:
            body = self._read_request_body()
            request = json.loads((body or b"{}").decode("utf-8-sig"))
            if request.get("pipeline") != AIFX_PIPELINE:
                raise ValueError(f"Unsupported pipeline: {request.get('pipeline')}")

            frames = request.get("templateSequence") or []
            style_reference = request.get("styleReferenceImage") or {}
            auto_prompt = request.get("autoPrompt") or {}
            if not frames:
                raise ValueError("templateSequence is required")
            if not style_reference.get("dataUrl"):
                raise ValueError("styleReferenceImage is required")

            timestamp = time.strftime("%Y%m%d-%H%M%S")
            request_dir = AIFX_REQUEST_ROOT / timestamp
            template_dir = request_dir / "template"
            reference_dir = request_dir / "reference"
            for index, frame in enumerate(frames):
                _write_data_url_image(str(frame.get("dataUrl") or ""), template_dir / f"frame_{index:03d}.png")
            reference_path = reference_dir / (Path(str(style_reference.get("fileName") or "reference.png")).name or "reference.png")
            _write_data_url_image(str(style_reference.get("dataUrl") or ""), reference_path)

            first = frames[0] if isinstance(frames[0], dict) else {}
            source_width = int(first.get("width") or request.get("width") or 768)
            source_height = int(first.get("height") or request.get("height") or 384)
            width = _align_vace_dimension(source_width)
            height = _align_vace_dimension(source_height)
            fps = int(request.get("fps") or 12)
            candidate_count = max(1, min(4, int(request.get("candidateCount") or 4)))
            positive_prompt = str(auto_prompt.get("positivePrompt") or "").strip()
            negative_prompt = str(auto_prompt.get("negativePrompt") or "").strip()
            inferred = str(auto_prompt.get("inferredEffectType") or "energy").strip() or "energy"
            prompt_variants = auto_prompt.get("promptVariants") if isinstance(auto_prompt, dict) else []
            prompt_variants_path = request_dir / "auto_prompt_variants.json"
            prompt_variants_path.write_text(
                json.dumps(
                    {
                        "inferredEffectType": inferred,
                        "promptVariants": prompt_variants if isinstance(prompt_variants, list) else [],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            script = Path(__file__).resolve().parent / "aifx_spritesheet_conditioned_regen_pipeline.py"
            cmd = [
                sys.executable,
                str(script),
                "--template-dir",
                str(template_dir),
                "--style-reference",
                str(reference_path),
                "--inferred-effect-type",
                inferred,
                "--candidate-count",
                str(candidate_count),
                "--fps",
                str(fps),
                "--timeout",
                str(int(request.get("timeout") or 3600)),
                "--prompt-variants-file",
                str(prompt_variants_path),
                "--max-cell-width",
                "384",
                "--max-cell-height",
                "192",
            ]
            if positive_prompt:
                cmd.extend(["--positive-prompt", positive_prompt])
            if negative_prompt:
                cmd.extend(["--negative-prompt", negative_prompt])

            started = time.time()
            completed = subprocess.run(
                cmd,
                cwd=str(Path(__file__).resolve().parents[1]),
                text=True,
                capture_output=True,
                timeout=int(request.get("timeout") or 3600) + 120,
            )
            run_stdout = completed.stdout or ""
            run_stderr = completed.stderr or ""
            output_dir = ""
            for line in reversed(run_stdout.splitlines()):
                line = line.strip()
                if not line.startswith("{"):
                    continue
                with contextlib.suppress(Exception):
                    parsed = json.loads(line)
                    output_dir = str(parsed.get("outputDir") or "")
                    break
            if not output_dir:
                marker = '"outputDir":'
                index = run_stdout.rfind(marker)
                if index >= 0:
                    snippet = run_stdout[run_stdout.rfind("{", 0, index):]
                    with contextlib.suppress(Exception):
                        output_dir = str(json.loads(snippet).get("outputDir") or "")
            summary_path = Path(output_dir) / "summary.json" if output_dir else None
            summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path and summary_path.exists() else {}
            if completed.returncode != 0 or summary.get("resultStatus") != "pass":
                self._write_json_response(
                    500,
                    {
                        "ok": False,
                        "pipeline": AIFX_PIPELINE,
                        "error": summary.get("failureReason") or run_stderr or "AIFX pipeline failed",
                        "stdout": run_stdout[-4000:],
                        "stderr": run_stderr[-4000:],
                        "summary": summary,
                    },
                )
                return

            response_candidates = []
            for candidate in summary.get("candidates") or []:
                frame_paths = [Path(path) for path in candidate.get("resultPngSequence") or []]
                frames_payload = [
                    {
                        "index": frame_index,
                        "fileName": frame_path.name,
                        "dataUrl": _file_to_data_url(frame_path),
                    }
                    for frame_index, frame_path in enumerate(frame_paths)
                    if frame_path.exists()
                ]
                response_candidates.append(
                    {
                        "id": candidate.get("id"),
                        "seed": candidate.get("seed"),
                        "promptVariant": candidate.get("promptVariant"),
                        "promptVariantName": candidate.get("promptVariantName"),
                        "outputPath": candidate.get("outputPath"),
                        "score": candidate.get("score"),
                        "positivePrompt": candidate.get("positivePrompt"),
                        "negativePrompt": candidate.get("negativePrompt"),
                        "inferredEffectType": candidate.get("inferredEffectType"),
                        "style_semantic_match": candidate.get("style_semantic_match"),
                        "usable": candidate.get("usable"),
                        "metrics": candidate.get("metrics") or {},
                        "frames": frames_payload,
                        "previewFrame": frames_payload[0]["dataUrl"] if frames_payload else "",
                    }
                )

            _append_aifx_debug_log(summary, request_dir)
            self._write_json_response(
                200,
                {
                    "ok": True,
                    "pipeline": AIFX_PIPELINE,
                    "elapsedSeconds": round(time.time() - started, 2),
                    "outputDir": output_dir,
                    "bestCandidateIndex": summary.get("bestCandidateId"),
                    "summary": summary,
                    "candidates": response_candidates,
                },
            )
        except Exception as exc:
            self._write_json_response(
                500,
                {
                    "ok": False,
                    "pipeline": AIFX_PIPELINE,
                    "error": str(exc),
                },
            )
        finally:
            AIFX_LOCK.release()

    def _write_proxy_response(self, status: int, headers, payload: bytes) -> None:
        self.send_response(status)
        for key, value in headers.items():
            key_lower = key.lower()
            if key_lower in HOP_BY_HOP_HEADERS:
                continue
            if key_lower == "access-control-allow-origin":
                continue
            self.send_header(key, value)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if payload:
            self.wfile.write(payload)

    def _write_text_error(self, status: int, message: str) -> None:
        payload = message.encode("utf-8", errors="replace")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _write_json_response(self, status: int, data: dict) -> None:
        payload = _json_bytes(data)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve NovaFlow preview runtime with a local Runtime proxy.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4783)
    parser.add_argument("--root", required=True)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    args = parser.parse_args()

    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        raise SystemExit(f"Renderer root not found: {root}")

    def handler_factory(*handler_args, **handler_kwargs):
        return PreviewRuntimeHandler(
            *handler_args,
            directory=root,
            default_base_url=normalize_base_url(args.base_url),
            **handler_kwargs,
        )

    httpd = ThreadingHTTPServer((args.host, args.port), handler_factory)
    try:
        try:
            admin_state = _ensure_novaflow_admin_server(args.host, args.port)
        except Exception as exc:
            admin_state = {"ok": False, "owned": False, "error": str(exc)[:400]}
            print(f"NovaFlow Preview Grok unavailable: {admin_state['error']}", file=sys.stderr, flush=True)
        grok_state = "ready" if admin_state.get("ok") else "unavailable"
        print(
            f"Serving {root} on http://{args.host}:{args.port} with Comfy proxy "
            f"{normalize_base_url(args.base_url)}; Grok {grok_state}"
        )
        with contextlib.suppress(KeyboardInterrupt):
            httpd.serve_forever()
    finally:
        httpd.server_close()
        _stop_prompt_assistant_process()
        _stop_owned_novaflow_admin_server()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
