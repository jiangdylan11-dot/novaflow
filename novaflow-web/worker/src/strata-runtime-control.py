"""Own one isolated Strata HTTP/engine/vision process tree.

The Node caller serializes actions and always calls unload in finally, including
after cancellation. API status alone is never evidence that VRAM/RAM is free.
This helper does not acquire components, prepare models, or modify system PATH.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import math
import os
import re
from pathlib import Path
import socket
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

import psutil


class ControlError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def error_summary(error):
    """Local diagnostics contain lifecycle facts, never HTTP bodies or config values."""
    result = {"errorCode": getattr(error, "code", "runtime-control-failed"), "errorType": type(error).__name__,
              "error": str(error) if isinstance(error, ControlError) else type(error).__name__}
    cause = error.__cause__ or error
    result["causeType"] = type(cause).__name__
    for name in ("pid", "errno", "winerror"):
        value = getattr(cause, name, None)
        if isinstance(value, (int, float)):
            result[name] = value
    return result


def diagnostic(settings, phase=None, event=None, error=None, pid=None):
    record = getattr(settings, "diagnostic", None)
    if record is None:
        return
    if phase is not None:
        record["phase"] = phase
    record["updatedAt"] = time.time()
    if event:
        item = {"event": event, "phase": record["phase"], "at": record["updatedAt"]}
        if error is not None:
            item.update(error_summary(error))
        if pid is not None:
            item["pid"] = pid
        record["events"] = [*record.get("events", [])[-19:], item]
    try:
        atomic_json(settings.last_command, record)
    except OSError:
        # Diagnostic I/O must not prevent the owned process cleanup itself.
        record["diagnosticWriteFailed"] = True


def canonical(value):
    return os.path.normcase(os.path.realpath(os.fspath(value)))


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()


def absolute(value, label):
    if not isinstance(value, str) or not Path(value).is_absolute():
        raise ControlError("invalid-config", label + " must be an absolute path")
    return str(Path(value).resolve())


class Settings:
    def __init__(self, path, receipt=None, *, owner_token=None, legacy_diagnostic=False):
        if owner_token is not None and not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", owner_token):
            raise ControlError("invalid-owner-token", "owner token has an invalid format")
        if owner_token is not None and legacy_diagnostic:
            raise ControlError("invalid-owner-token", "Choose token ownership or explicit legacy diagnostics")
        self.owner_token, self.legacy_diagnostic = owner_token, legacy_diagnostic
        self.path = absolute(str(Path(path).resolve()), "config")
        self.raw = read_json(self.path)
        self.python = absolute(self.raw.get("pythonPath"), "pythonPath")
        self.control = absolute(self.raw.get("controlRoot"), "controlRoot")
        self.server_path = absolute(self.raw.get("serverConfigPath"), "serverConfigPath")
        self.server = read_json(self.server_path)
        self.receipt = absolute(receipt or self.raw.get("receiptPath") or str(Path(self.path).with_suffix(".receipt.json")), "receiptPath")
        self.ready = absolute(self.raw.get("readyFilePath") or self.receipt + ".ready.json", "readyFilePath")
        self.log = absolute(self.raw.get("logPath") or self.receipt + ".log", "logPath")
        self.last_command = absolute(self.raw.get("lastCommandPath") or str(Path(self.receipt).parent / "control-command-result.json"), "lastCommandPath")
        if canonical(self.last_command) in {canonical(value) for value in (self.path, self.server_path, self.receipt, self.ready, self.log)}:
            raise ControlError("invalid-config", "lastCommandPath must not overwrite runtime configuration or ownership files")
        self.base = self.raw.get("baseUrl", "http://127.0.0.1:8198").rstrip("/")
        url = urllib.parse.urlsplit(self.base)
        if (url.scheme != "http" or url.hostname != "127.0.0.1" or url.username or url.password
                or url.path or url.query or url.fragment or not url.port or url.port in {8188, 8189, 8190, 8192, 4787, 4794}):
            raise ControlError("invalid-config", "baseUrl must use an independent 127.0.0.1 HTTP port")
        self.port = url.port
        self.heavy = {canonical(absolute(self.server.get("exe"), "server.exe"))}
        if self.server.get("vision"):
            self.heavy.add(canonical(absolute(self.server["vision"].get("exe"), "vision.exe")))
        if self.server.get("before_load") or self.server.get("mcp_servers"):
            raise ControlError("invalid-config", "before_load and MCP are not supported by this isolated runtime")

    def command(self):
        return [self.python, "-m", "serve.server", "--engine", "strata", "--config", self.server_path,
                "--host", "127.0.0.1", "--port", str(self.port), "--lazy", "--offline", "--ready-file", self.ready]

    def preflight_load(self):
        for value in [self.python, str(Path(self.control) / "serve/server.py"), *self.heavy]:
            if not Path(value).is_file():
                raise ControlError("runtime-missing", "A configured Strata runtime file is missing")
        models = self.raw.get("modelFiles")
        if not isinstance(models, list) or not models:
            raise ControlError("model-missing", "modelFiles must list the independently verified local weights")
        for item in models:
            path = Path(item if isinstance(item, str) else item.get("path", ""))
            expected = item.get("bytes", item.get("size")) if isinstance(item, dict) else None
            if not path.is_absolute() or not path.is_file() or (expected is not None and path.stat().st_size != expected):
                raise ControlError("model-incomplete", "A configured model file is missing or has the wrong byte length")
        tokenizer = Path(self.server.get("tokenizer", ""))
        if not tokenizer.is_absolute() or not (tokenizer / "vocab.json").is_file():
            raise ControlError("pack-missing", "Prepare the local IQ pack/tokenizer before starting Strata")
        args = self.server.get("args", [])
        if not isinstance(args, list) or not all(isinstance(item, str) for item in args) or "--pack" not in args:
            raise ControlError("invalid-config", "The engine requires an explicit local --pack")
        try:
            pack = Path(args[args.index("--pack") + 1])
        except IndexError as error:
            raise ControlError("invalid-config", "--pack has no path") from error
        if not pack.is_absolute() or not all((pack / name).is_file() for name in ("dense.bin", "index.txt")):
            raise ControlError("pack-missing", "The IQ dense pack/index is incomplete")


def require_operation_owner(settings):
    if not settings.owner_token and not settings.legacy_diagnostic:
        raise ControlError("owner-token-required", "load/unload requires --owner-token; manual legacy recovery must explicitly use --legacy-diagnostic")


def foreign_owner_result(settings, receipt):
    if not settings.legacy_diagnostic and receipt.get("ownerToken") != settings.owner_token:
        # This proves only that THIS operation owns no current runtime. It is
        # deliberately not a claim that the other client's RAM/VRAM is free.
        return {"ok": True, "released": True, "notOwned": True,
                "foreignRuntimePreserved": True, "releaseScope": "operation-token"}
    return None


@contextlib.contextmanager
def operation_lock(settings):
    """OS-held lock: serialize claim/load/stop across independent coordinators.

    Held for a full load/stop; process exit/cancellation releases it in the OS.
    Foreign unload takes its no-op path before this lock, so it never waits on
    or interrupts another client's long model load.
    """
    path = Path(settings.receipt + ".operation.lock")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        if handle.seek(0, os.SEEK_END) == 0:
            handle.write(b"\0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise ControlError("runtime-busy", "Another owned lifecycle operation is active; no process was changed") from error
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def process_identity(process, include_cmdline=True):
    identity = {"pid": process.pid, "createTime": process.create_time(), "exe": canonical(process.exe())}
    # Windows can deny PEB/command-line reads for native CUDA helpers while
    # still exposing their PID, creation time and exact executable. Those are
    # the child ownership proof; only the owned HTTP parent's launch needs a
    # command-line match. Do not make cleanup depend on an unrelated PEB right.
    if include_cmdline:
        identity["cmdline"] = process.cmdline()
    return identity


def identity_process(identity):
    """Never signal a reused PID or a process whose identity cannot be read."""
    try:
        process = psutil.Process(int(identity["pid"]))
        actual = process_identity(process, include_cmdline=False)
    except psutil.NoSuchProcess:
        return None
    except (psutil.AccessDenied, OSError) as error:
        raise ControlError("ownership-unconfirmed", "Cannot inspect an owned process identity") from error
    if (not math.isfinite(float(identity["createTime"]))
            or abs(actual["createTime"] - float(identity["createTime"])) > 0.001
            or actual["exe"] != canonical(identity["exe"])):
        raise ControlError("ownership-mismatch", "PID identity changed; no signal was sent to that process")
    return process


def port_open(settings):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
        connection.settimeout(0.25)
        return connection.connect_ex(("127.0.0.1", settings.port)) == 0


def exact_heavy_processes(settings):
    found = []
    for process in psutil.process_iter(["pid", "exe"]):
        try:
            if process.info.get("exe") and canonical(process.info["exe"]) in settings.heavy:
                found.append(process_identity(process, include_cmdline=False))
        except psutil.NoSuchProcess:
            continue
        except psutil.AccessDenied as error:
            raise ControlError("release-unconfirmed", "Cannot identify an isolated engine process") from error
    return found


def http(settings, method, endpoint, timeout):
    headers = {"Content-Type": "application/json"}
    key = settings.server.get("api_key")
    if isinstance(key, str) and key and key.lower() not in {"none", "off"}:
        headers["Authorization"] = "Bearer " + key
    request = urllib.request.Request(settings.base + endpoint, data=b"{}" if method == "POST" else None,
                                     method=method, headers=headers)
    # Do not forward localhost requests to environment-configured proxies.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=timeout) as response:
        return json.load(response)


class Owner:
    def __init__(self, settings, receipt):
        self.settings, self.receipt = settings, receipt
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.monitor_error = None

    @classmethod
    def read(cls, settings):
        receipt = read_json(settings.receipt)
        if (receipt.get("schemaVersion") != 1 or canonical(receipt.get("configPath", "")) != canonical(settings.path)
                or canonical(receipt.get("serverConfigPath", "")) != canonical(settings.server_path)
                or receipt.get("baseUrl") != settings.base):
            raise ControlError("ownership-mismatch", "Receipt does not belong to this runtime configuration")
        parent = receipt.get("http", {})
        if canonical(parent.get("exe", "")) != canonical(settings.python) or parent.get("cmdline") != settings.command():
            raise ControlError("ownership-mismatch", "Receipt HTTP launch identity does not match the configured command")
        return cls(settings, receipt)

    def save(self):
        self.receipt["updatedAt"] = time.time()
        atomic_json(self.settings.receipt, self.receipt)

    def parent(self):
        process = identity_process(self.receipt["http"])
        if process is not None:
            try:
                if process.cmdline() != self.settings.command():
                    raise ControlError("ownership-mismatch", "HTTP process command changed; no signal was sent")
            except psutil.NoSuchProcess:
                return None
            except (psutil.AccessDenied, OSError) as error:
                raise ControlError("ownership-unconfirmed", "Cannot inspect the owned HTTP command") from error
        return process

    def capture(self):
        with self.lock:
            parent = self.parent()
            ledger = {(item["pid"], item["createTime"]): item for item in self.receipt.get("children", [])}
            if parent is not None:
                try:
                    children = parent.children(recursive=True)
                except psutil.NoSuchProcess:
                    children = []
                for child in children:
                    try:
                        item = process_identity(child, include_cmdline=False)
                    except psutil.NoSuchProcess:
                        continue
                    except psutil.AccessDenied as error:
                        if any(item["pid"] == child.pid for item in ledger.values()):
                            # A seen child can lose query rights while exiting. Keep
                            # its original identity; later signals still revalidate it.
                            diagnostic(self.settings, event="known-child-capture-deferred", error=error, pid=child.pid)
                            continue
                        raise ControlError("child-ownership-unconfirmed", "Cannot identify a newly observed child; it will not be signaled") from error
                    previous = [entry for entry in ledger.values() if entry["pid"] == item["pid"]]
                    if any(abs(entry["createTime"] - item["createTime"]) > 0.001 or entry["exe"] != item["exe"] for entry in previous):
                        raise ControlError("ownership-mismatch", "A recorded child PID was reused; that process will not be signaled")
                    item["observedParentPid"] = parent.pid
                    ledger[(item["pid"], item["createTime"])] = item
            self.receipt["children"] = list(ledger.values())
            self.save()

    def watch(self):
        while not self.stop.wait(0.1):
            try:
                self.capture()
            except Exception as error:
                self.monitor_error = error
                return

    @contextlib.contextmanager
    def monitoring(self):
        self.capture()
        thread = threading.Thread(target=self.watch, name="strata-owned-process-ledger", daemon=True)
        thread.start()
        try:
            yield
        finally:
            self.stop.set()
            thread.join(timeout=2)
            self.capture()
        if self.monitor_error:
            raise self.monitor_error


def remaining_identities(identities, settings=None):
    remaining = []
    for item in identities:
        try:
            if identity_process(item) is not None:
                remaining.append(item)
        except ControlError as error:
            if error.code != "ownership-unconfirmed":
                raise
            remaining.append(item)  # Unreadable never means dead.
            if settings is not None:
                diagnostic(settings, event="exit-identity-deferred", error=error, pid=item["pid"])
    return remaining


def remaining_released_identities(owner):
    """Read-only stale-receipt check; never grants ownership of a reused PID."""
    children = owner.receipt.get("children")
    if owner.receipt.get("state") != "released" or not isinstance(children, list):
        raise ControlError("ownership-mismatch", "Released receipt identities are invalid")
    identities = [owner.receipt["http"], *children]
    for item in identities:
        if (not isinstance(item, dict) or type(item.get("pid")) is not int or item["pid"] <= 0
                or type(item.get("createTime")) not in (int, float)
                or not math.isfinite(item["createTime"]) or item["createTime"] <= 0
                or not isinstance(item.get("exe"), str) or not Path(item["exe"]).is_absolute()):
            raise ControlError("ownership-mismatch", "Released receipt identities are invalid")
    remaining = []
    for item in identities:
        try:
            actual = process_identity(psutil.Process(item["pid"]), include_cmdline=False)
        except psutil.NoSuchProcess:
            continue
        except (psutil.AccessDenied, OSError) as error:
            raise ControlError("ownership-unconfirmed", "Cannot inspect a released process identity") from error
        if not math.isfinite(actual["createTime"]) or actual["createTime"] <= 0:
            raise ControlError("ownership-unconfirmed", "Cannot confirm a released process creation time")
        if abs(actual["createTime"] - item["createTime"]) > 0.001:
            continue  # The old instance ended; do not inspect children or signal the new one.
        if actual["exe"] != canonical(item["exe"]):
            raise ControlError("ownership-mismatch", "Released PID executable changed without a new creation time")
        remaining.append(item)
    return remaining


def wait_dead(identities, seconds, settings=None):
    deadline = time.monotonic() + seconds
    while True:
        remaining = remaining_identities(identities, settings)
        if not remaining or time.monotonic() >= deadline:
            return remaining
        time.sleep(0.05)


def signal_owned(identity, method, settings=None, command=None):
    try:
        process = identity_process(identity)
        if process is None:
            return
        if command is not None and process.cmdline() != command:
            raise ControlError("ownership-mismatch", "HTTP command changed; no signal was sent")
        getattr(process, method)()
    except psutil.NoSuchProcess:
        return
    except (psutil.AccessDenied, OSError) as error:
        if settings is not None:
            diagnostic(settings, event="signal-deferred", error=error, pid=identity["pid"])
    except ControlError as error:
        if error.code != "ownership-unconfirmed":
            raise
        if settings is not None:
            diagnostic(settings, event="signal-deferred", error=error, pid=identity["pid"])


def remove_owned_ready(owner):
    path = Path(owner.settings.ready)
    if not path.exists():
        return
    record = read_json(path)
    if (record.get("pid") != owner.receipt["http"]["pid"]
            or record.get("bound_host") != "127.0.0.1" or record.get("bound_port") != owner.settings.port
            or record.get("created_at", 0) < owner.receipt.get("startedAt", owner.receipt["http"]["createTime"]) - 1
            or (owner.receipt.get("instanceId") and record.get("instance_id") != owner.receipt["instanceId"])):
        raise ControlError("ready-ownership-mismatch", "Ready file is not owned by this exited HTTP instance; it was not removed")
    path.unlink()  # Called only after process exit and closed-port proof.


def stop_owned(owner, timeout):
    deadline = time.monotonic() + timeout
    diagnostic(owner.settings, "capture-before-stop")
    capture_error = None
    try:
        owner.capture()
    except Exception as error:
        if isinstance(error, ControlError) and error.code == "ownership-mismatch":
            raise
        capture_error = error
        diagnostic(owner.settings, event="cleanup-capture-error", error=error)
    identities = [owner.receipt["http"], *owner.receipt.get("children", [])]
    # Refuse known PID reuse before signaling anything. Query denial only defers.
    remaining_identities(identities, owner.settings)
    diagnostic(owner.settings, "terminate-owned")
    for item in identities:
        signal_owned(item, "terminate", owner.settings,
                     owner.settings.command() if item is identities[0] else None)
    remaining = wait_dead(identities, min(5, max(0, deadline - time.monotonic()) / 2), owner.settings)
    diagnostic(owner.settings, "kill-owned-if-still-alive")
    for item in remaining:
        signal_owned(item, "kill", owner.settings,
                     owner.settings.command() if item is identities[0] else None)
    diagnostic(owner.settings, "confirm-release")
    while True:
        remaining = remaining_identities(identities, owner.settings)
        try:
            heavy = exact_heavy_processes(owner.settings)
            open_port = port_open(owner.settings)
            confirmed = not remaining and not heavy and not open_port
        except (ControlError, psutil.AccessDenied, OSError) as error:
            if isinstance(error, ControlError) and error.code == "ownership-mismatch":
                raise
            confirmed = False
            diagnostic(owner.settings, event="final-scan-deferred", error=error)
        if confirmed:
            break
        if time.monotonic() >= deadline:
            raise ControlError("release-unconfirmed", "Owned HTTP/engine/vision exit is not fully confirmed")
        time.sleep(min(0.05, max(0, deadline - time.monotonic())))
    if capture_error is not None and getattr(capture_error, "code", None) != "ownership-unconfirmed":
        # Unknown new children never become proven ownership merely because the
        # known tree was stopped. Fail closed after the best-effort cleanup.
        raise capture_error
    remove_owned_ready(owner)
    owner.receipt.update(state="released", releasedAt=time.time())
    owner.save()
    return {"ok": True, "released": True, "ownedHttpPid": owner.receipt["http"]["pid"],
            "ownedChildPids": [item["pid"] for item in identities[1:]], "releasedAt": owner.receipt["releasedAt"]}


def unload(settings, timeout=45):
    require_operation_owner(settings)
    if Path(settings.receipt).exists():
        result = foreign_owner_result(settings, Owner.read(settings).receipt)
        if result is not None:
            return result
    with operation_lock(settings):
        return _unload_owned(settings, timeout)


def _unload_owned(settings, timeout=45):
    deadline = time.monotonic() + timeout
    diagnostic(settings, "read-owner")
    if not Path(settings.receipt).exists():
        if port_open(settings) or exact_heavy_processes(settings):
            raise ControlError("ownership-unconfirmed", "Runtime exists without an ownership receipt; nothing was killed")
        return {"ok": True, "released": True, "alreadyStopped": True, "releasedAt": time.time()}
    owner = Owner.read(settings)
    result = foreign_owner_result(settings, owner.receipt)
    if result is not None:
        return result  # Recheck after acquiring the lock; receipt may change.
    api_status = None
    monitoring_error = None
    try:
        owner.capture()  # PID mismatch fails before HTTP or any signal.
        if owner.parent() is not None:
            diagnostic(settings, "api-unload")
            with owner.monitoring():
                try:
                    api_status = http(settings, "POST", "/unload?wait=2", min(8, max(1, timeout / 3)))
                except (OSError, ValueError, urllib.error.URLError) as error:
                    api_status = {"status": "unconfirmed"}
                    diagnostic(settings, event="api-unload-unconfirmed", error=error)
    except Exception as error:
        monitoring_error = error
        diagnostic(settings, event="unload-monitor-error", error=error)
    # API timeouts and monitor failures must not skip owned process cleanup.
    result = stop_owned(owner, max(0.1, deadline - time.monotonic()))
    if monitoring_error is not None:
        raise monitoring_error
    result["apiUnloadStatus"] = api_status.get("status") if isinstance(api_status, dict) else None
    return result


def load(settings, timeout=220):
    require_operation_owner(settings)
    with operation_lock(settings):
        return _load_owned(settings, timeout)


def _load_owned(settings, timeout=220):
    diagnostic(settings, "load-preflight")
    settings.preflight_load()
    if Path(settings.receipt).exists():
        owner = Owner.read(settings)
        if owner.receipt.get("state") == "released":
            if remaining_released_identities(owner):
                raise ControlError("runtime-busy", "A released runtime instance is still alive; nothing was changed")
        else:
            if owner.parent() is not None:
                raise ControlError("runtime-busy", "An owned Strata HTTP instance already exists; unload it first")
            if foreign_owner_result(settings, owner.receipt) is not None:
                if (remaining_identities([owner.receipt["http"], *owner.receipt.get("children", [])], settings)
                        or port_open(settings) or exact_heavy_processes(settings) or Path(settings.ready).exists()):
                    raise ControlError("runtime-busy", "A different operation still owns runtime resources; nothing was changed")
            else:
                _unload_owned(settings, min(30, timeout))
    if port_open(settings) or exact_heavy_processes(settings):
        raise ControlError("runtime-busy", "The isolated port or engine path is already in use; nothing was killed")
    if Path(settings.ready).exists():
        raise ControlError("ready-ownership-unconfirmed", "An unowned ready file exists; it was not removed")
    Path(settings.log).parent.mkdir(parents=True, exist_ok=True)
    Path(settings.ready).parent.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    for key in ("PYTHONHOME", "PYTHONPATH", "STRATA_API_KEY"):
        env.pop(key, None)
    state = Path(settings.receipt).parent / "strata-state"
    state.mkdir(parents=True, exist_ok=True)
    temporary = state / "tmp"
    temporary.mkdir(exist_ok=True)
    env.update(PYTHONNOUSERSITE="1", PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8",
               STRATA_NO_ACQUIRE="1", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
               STRATA_DATA_DIR=str(state), STRATA_COMPONENTS_DIR=str(state / "components"),
               TMP=str(temporary), TEMP=str(temporary))
    started = time.time()
    diagnostic(settings, "launch-lazy-http")
    with open(settings.log, "ab", buffering=0) as log:
        process = subprocess.Popen(settings.command(), cwd=settings.control, env=env, stdin=subprocess.DEVNULL,
                                   stdout=log, stderr=subprocess.STDOUT,
                                   creationflags=(subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP) if os.name == "nt" else 0)
    owner = None
    try:
        owner = Owner(settings, {"schemaVersion": 1, "configPath": settings.path, "serverConfigPath": settings.server_path,
                                "baseUrl": settings.base, "http": process_identity(psutil.Process(process.pid)),
                                "children": [], "state": "starting", "startedAt": started,
                                **({"ownerToken": settings.owner_token} if settings.owner_token else {})})
        owner.save()  # Persist before the first load request can spawn heavy children.
        deadline = time.monotonic() + timeout
        with owner.monitoring():
            while True:
                if owner.parent() is None:
                    raise ControlError("http-exited", "Strata HTTP exited before becoming ready; inspect its local log")
                try:
                    ready = read_json(settings.ready)
                    if (ready.get("pid") == process.pid and ready.get("created_at", 0) >= started - 1
                            and ready.get("bound_port") == settings.port and ready.get("bound_host") == "127.0.0.1"):
                        owner.receipt["instanceId"] = ready.get("instance_id")
                        break
                except (OSError, ValueError):
                    pass
                if time.monotonic() >= deadline:
                    raise ControlError("load-timeout", "Timed out waiting for the owned lazy HTTP instance")
                time.sleep(0.1)
            owner.receipt["state"] = "loading"
            owner.capture()
            diagnostic(settings, "api-load")
            loaded = http(settings, "POST", "/load", max(1, deadline - time.monotonic()))
            diagnostic(settings, "load-health")
            health = http(settings, "GET", "/health", 5)
            if health.get("loaded") is not True:
                raise ControlError("load-unconfirmed", "Strata did not confirm the text engine is loaded")
            owner.receipt.update(state="loaded", loadedAt=time.time())
            owner.capture()
        return {"ok": True, "loaded": True, "ownedHttpPid": process.pid,
                "ownerToken": settings.owner_token, "releaseScope": "operation-token" if settings.owner_token else "explicit-legacy-diagnostic",
                "ownedChildPids": [item["pid"] for item in owner.receipt["children"]],
                "instanceId": owner.receipt.get("instanceId"), "loadMs": round((time.time() - started) * 1000),
                "apiLoadStatus": loaded.get("status") if isinstance(loaded, dict) else None}
    except BaseException as error:
        # Caller cancellation can kill this helper; Node finally must call unload
        # using the durable receipt. Normal errors clean up before returning.
        diagnostic(settings, event="load-error", error=error)
        try:
            if owner is not None:
                stop_owned(owner, 20)
            else:
                # The newly-created HTTP has not received /load, so it cannot
                # have spawned engine/vision yet. Its Popen handle is our own
                # launch proof even if identity/receipt setup failed.
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        except Exception as cleanup_error:
            diagnostic(settings, event="load-cleanup-error", error=cleanup_error)
        raise


def resource_snapshot(settings):
    executable = shutil.which('nvidia-smi')
    if not executable:
        raise ControlError('resource-probe-missing', 'nvidia-smi is required to confirm the GPU memory floor')
    gpu = int(settings.server.get('gpu', 0))
    try:
        reply = subprocess.run([executable, f'--id={gpu}', '--query-gpu=memory.free,memory.total', '--format=csv,noheader,nounits'],
                               capture_output=True, text=True, timeout=5,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        values = [int(value.strip()) for value in reply.stdout.strip().split(',')]
        if reply.returncode or len(values) != 2 or not 0 <= values[0] <= values[1]:
            raise ValueError('invalid memory response')
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        raise ControlError('resource-probe-failed', 'Cannot confirm GPU memory availability') from error
    return {'ok': True, 'availableRamBytes': psutil.virtual_memory().available,
            'freeVramMiB': values[0], 'totalVramMiB': values[1], 'sampledAt': time.time()}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("plan", "load", "unload", "status", "resources"))
    parser.add_argument("--config", required=True)
    parser.add_argument("--receipt")
    parser.add_argument("--timeout", type=float)
    parser.add_argument("--owner-token", help="Opaque operation ID required for production load/unload")
    parser.add_argument("--legacy-diagnostic", action="store_true", help="Explicit manual legacy recovery; may stop the configured receipt regardless of token")
    args = parser.parse_args(argv)
    settings = None
    try:
        if args.timeout is not None and (not math.isfinite(args.timeout) or args.timeout <= 0):
            raise ControlError("invalid-timeout", "timeout must be finite and positive")
        settings = Settings(args.config, args.receipt, owner_token=args.owner_token, legacy_diagnostic=args.legacy_diagnostic)
        if args.command == 'resources':
            # A frequent read-only probe must not overwrite lifecycle diagnostics
            # or the ownership receipt while load/unload is running.
            print(json.dumps(resource_snapshot(settings)))
            return 0
        settings.diagnostic = {"schemaVersion": 1, "command": args.command, "phase": "begin",
                               "state": "running", "startedAt": time.time(), "events": []}
        diagnostic(settings)
        if args.command == "plan":
            result = {"ok": True, "command": settings.command(), "cwd": settings.control,
                      "receiptPath": settings.receipt, "readyFilePath": settings.ready,
                      "heavyExecutables": sorted(settings.heavy), "offline": True, "lazy": True}
        elif args.command == "load":
            result = load(settings, args.timeout or 220)
        elif args.command == "unload":
            result = unload(settings, args.timeout or 45)
        else:
            owner = Owner.read(settings) if Path(settings.receipt).exists() else None
            result = {"ok": True, "ownedHttpAlive": owner.parent() is not None if owner else False,
                      "portOpen": port_open(settings), "heavyProcesses": exact_heavy_processes(settings)}
        settings.diagnostic.update(state="complete", finishedAt=time.time(), result=result, errorCode=None, error=None)
        diagnostic(settings)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as error:
        result = {"ok": False, "released": False, **error_summary(error)}
        if settings is not None and getattr(settings, "diagnostic", None) is not None:
            settings.diagnostic.update(state="failed", finishedAt=time.time(), result=result, **error_summary(error))
            diagnostic(settings)
        print(json.dumps(result, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
