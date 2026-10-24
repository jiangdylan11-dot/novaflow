"""Owned Comfy QA lifecycle copied unchanged from the completed fast-disk probe.
No server starts at import. Only the caller supplies a fresh work run root.
"""
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import socket
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import uuid

HERE = None
BASE = None
COMFY = Path("C:/ProgramData/NovaFlow/AI-Runtime/engine/ComfyUI")
PORT = 8192
URL = "http://127.0.0.1:8192"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
FATAL_GPU = re.compile(r"illegal memory access|device-side assert|device (?:is )?lost|fallen off the bus|driver shutting down|unspecified launch failure|CUDA out of memory|NVRM.*Xid", re.I)

def configure(run_root):
    global HERE, BASE
    HERE = Path(run_root).resolve()
    BASE = HERE / "comfy-root"

def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(Path(path).read_bytes())


def checked(path, expected):
    data = Path(path).read_bytes()
    if digest(data) != expected:
        raise RuntimeError(f"SHA256 mismatch: {path}")
    return data


def save(path, value, *, exclusive=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    if exclusive:
        with path.open("x", encoding="utf-8", newline="\n") as file:
            file.write(data)
    else:
        temp = path.with_name(path.name + ".next")
        temp.write_text(data, encoding="utf-8", newline="\n")
        temp.replace(path)


def emit(phase, **data):
    print(json.dumps({"phase": phase, **data}, ensure_ascii=False), flush=True)


def port_open(port):
    with socket.socket() as sock:
        sock.settimeout(0.4)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def http(base, path, body=None, *, raw=False, timeout=8, headers=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(base + path, data=data,
        headers={"Content-Type": "application/json", **(headers or {})})
    with OPENER.open(request, timeout=timeout) as response:
        content = response.read()
        if raw:
            return content
        return json.loads(content) if content.strip() else {"httpStatus": response.status}


def other_services_idle():
    state = {}
    for port in (8191, 8198):
        state[str(port)] = {"listening": port_open(port)}
        if state[str(port)]["listening"]:
            raise RuntimeError(f"Analyzer {port} is active; no other service will be stopped")
    for port in (8188, 8189, 8190):
        if not port_open(port):
            state[str(port)] = {"listening": False, "queueState": "not-listening"}
            continue
        queue = http(f"http://127.0.0.1:{port}", "/queue")
        if not isinstance(queue.get("queue_running"), list) or not isinstance(queue.get("queue_pending"), list):
            raise RuntimeError(f"Cannot verify queue {port}")
        state[str(port)] = {"listening": True, "queue_running": queue["queue_running"], "queue_pending": queue["queue_pending"]}
        if queue["queue_running"] or queue["queue_pending"]:
            raise RuntimeError(f"Comfy queue {port} is occupied; it is left untouched")
    return state


def resolve_under(root, *parts):
    root = Path(root).resolve()
    path = root.joinpath(*parts).resolve()
    if not path.is_relative_to(root):
        raise RuntimeError(f"Path escapes isolated root: {path}")
    return path


def graph_differences(a, b, prefix=""):
    if a == b:
        return []
    if isinstance(a, dict) and isinstance(b, dict):
        result = []
        for key in sorted(set(a) | set(b)):
            path = f"{prefix}.{key}" if prefix else key
            if key not in a or key not in b:
                result.append(path)
            else:
                result.extend(graph_differences(a[key], b[key], path))
        return result
    return [prefix]


class OwnedServer:
    def __init__(self, psutil, command):
        self.psutil, self.command, self.process = psutil, command, None
        self.identities = {}
        self.lock = threading.RLock()
        self.handles = []

    def identity(self, process):
        return {"pid": process.pid, "createTime": process.create_time(), "exe": process.exe(), "cmdline": process.cmdline(), "ppid": process.ppid()}

    def same_process(self, ident):
        try:
            process = self.psutil.Process(ident["pid"])
            return process if abs(process.create_time() - ident["createTime"]) < 0.001 and process.exe().lower() == ident["exe"].lower() and process.cmdline() == ident["cmdline"] else None
        except self.psutil.Error:
            return None

    def remember_children(self):
        if not self.process:
            return
        with self.lock:
            main = self.identities.get(self.process.pid)
            process = self.same_process(main) if main else None
            if process:
                try:
                    children = process.children(recursive=True)
                except self.psutil.NoSuchProcess:
                    children = []
                for child in children:
                    try:
                        self.identities[child.pid] = self.identity(child)
                    except self.psutil.Error:
                        pass

    def assert_owned(self):
        if not self.process or self.process.poll() is not None:
            raise RuntimeError("Owned Comfy child exited")
        if not self.same_process(self.identities[self.process.pid]):
            raise RuntimeError("Owned PID identity changed; refuse HTTP mutation")

    def assert_listener_owned(self):
        self.assert_owned()
        listeners = [c for c in self.psutil.net_connections(kind="tcp") if c.status == self.psutil.CONN_LISTEN and c.laddr.port == PORT]
        if not listeners or any(c.pid != self.process.pid for c in listeners):
            raise RuntimeError("8192 listener is not the exact owned child")

    def call(self, path, body=None, **kwargs):
        self.assert_listener_owned()
        return http(URL, path, body, **kwargs)

    def start(self):
        if port_open(PORT):
            raise RuntimeError("8192 became occupied before launch")
        env = os.environ.copy()
        env.update(PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", TEMP=str(BASE / "temp"), TMP=str(BASE / "temp"),
                   HF_HOME=str(BASE / "cache/huggingface"), TORCH_HOME=str(BASE / "cache/torch"), XDG_CACHE_HOME=str(BASE / "cache"))
        self.handles = [(HERE / name).open("xb") for name in ("stdout.log", "stderr.log")]
        self.process = subprocess.Popen(self.command, cwd=str(COMFY), env=env, stdin=subprocess.DEVNULL,
            stdout=self.handles[0], stderr=self.handles[1], creationflags=subprocess.CREATE_NO_WINDOW, close_fds=True)
        self.identities[self.process.pid] = self.identity(self.psutil.Process(self.process.pid))
        receipt = {"pid": self.process.pid, "port": PORT, "command": self.command, "cwd": str(COMFY),
            "identity": self.identities[self.process.pid], "creationFlag": "CREATE_NO_WINDOW", "startedAt": time.time(),
            "scope": "Only this owned Comfy child and descendants may be stopped"}
        save(HERE / "owned-server.json", receipt, exclusive=True)
        save(HERE / "load.json", {"started": True, "ready": False, **receipt}, exclusive=True)

    def stop(self):
        if not self.process:
            return {"serverWasStarted": False}
        self.remember_children()
        with self.lock:
            identities = list(self.identities.values())
        stopped, skipped, processes = [], [], []
        for ident in sorted(identities, key=lambda i: i["pid"] == self.process.pid):
            process = self.same_process(ident)
            if process is None:
                skipped.append({**ident, "reason": "already gone or identity mismatch; never kill a reused PID"})
                continue
            try:
                process.terminate()
                processes.append((process, ident))
                stopped.append(ident)
            except self.psutil.NoSuchProcess:
                pass
        _, alive = self.psutil.wait_procs([p for p, _ in processes], timeout=8)
        for process in alive:
            ident = next(i for p, i in processes if p.pid == process.pid)
            current = self.same_process(ident)
            if current:
                current.kill()
        self.psutil.wait_procs(alive, timeout=8)
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pass
        for file in self.handles:
            file.close()
        remaining = [i for i in identities if self.same_process(i)]
        return {"serverWasStarted": True, "terminatedOwnedIdentities": stopped, "skippedIdentities": skipped,
                "remainingOwnedIdentities": remaining, "port8192ListeningAfterStop": port_open(PORT), "exitCode": self.process.poll()}


class ResourceGuard:
    def __init__(self, psutil, nvidia, owner, options):
        self.psutil, self.nvidia, self.owner, self.options = psutil, nvidia, owner, options
        self.stop_event, self.abort = threading.Event(), threading.Event()
        self.reason, self.samples, self.latest = None, [], None
        self.thread = threading.Thread(target=self.loop, daemon=True)

    def sample(self):
        call = subprocess.run([self.nvidia, "--query-gpu=index,memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=6, creationflags=subprocess.CREATE_NO_WINDOW)
        if call.returncode:
            raise RuntimeError("nvidia-smi driver query failed: " + call.stderr[-1000:])
        row = next((line for line in call.stdout.splitlines() if line.split(",")[0].strip() == "0"), None)
        if row is None:
            raise RuntimeError("No GPU0 resource row")
        _, used, total, util = [float(v.strip()) for v in row.split(",")]
        sample = {"at": time.time(), "ramAvailableBytes": self.psutil.virtual_memory().available,
                  "vramUsedMiB": used, "vramTotalMiB": total, "gpuUtilization": util}
        self.samples.append(sample)
        self.latest = sample
        with (HERE / "resource-samples.jsonl").open("a", encoding="utf-8") as file:
            file.write(json.dumps(sample) + "\n")
        return sample

    def fail(self, reason):
        if not self.abort.is_set():
            self.reason = reason
            self.abort.set()
            emit("resource-abort", reason=reason)

    def check(self):
        if self.abort.is_set():
            raise RuntimeError(self.reason)

    def loop(self):
        low_since = None
        offsets = {name: 0 for name in ("stdout.log", "stderr.log")}
        try:
            while not self.stop_event.is_set():
                sample = self.sample()
                low = (sample["ramAvailableBytes"] < self.options.min_ram_gib * 1073741824 or
                       sample["vramTotalMiB"] - sample["vramUsedMiB"] < self.options.min_vram_free_mib)
                if low:
                    low_since = low_since or time.monotonic()
                    if time.monotonic() - low_since >= self.options.low_headroom_seconds:
                        self.fail("Sustained low physical RAM/VRAM headroom; stop owned QA without retry")
                else:
                    low_since = None
                if sample["ramAvailableBytes"] < 1073741824:
                    self.fail("Available physical RAM below 1 GiB")
                for name in offsets:
                    path = HERE / name
                    if path.exists():
                        with path.open("rb") as file:
                            file.seek(offsets[name])
                            text = file.read().decode("utf-8", errors="replace")
                            offsets[name] = file.tell()
                        match = FATAL_GPU.search(text)
                        if match:
                            self.fail("Fatal GPU/driver log: " + match.group(0))
                self.owner.remember_children()
                self.stop_event.wait(1.0)
        except Exception as exc:
            self.fail("Resource monitor failed: " + str(exc))

    def close(self):
        self.stop_event.set()
        self.thread.join(timeout=8)
        save(HERE / "resource-summary.json", {"samples": len(self.samples), "sampledMaxVRAMMiB": max((s["vramUsedMiB"] for s in self.samples), default=None),
            "sampledMinRAMAvailableBytes": min((s["ramAvailableBytes"] for s in self.samples), default=None),
            "first": self.samples[0] if self.samples else None, "last": self.samples[-1] if self.samples else None,
            "abortReason": self.reason, "limits": {"minRAMGiB": self.options.min_ram_gib, "minVRAMFreeMiB": self.options.min_vram_free_mib,
            "sustainedSeconds": self.options.low_headroom_seconds}, "scope": "Sampled whole-device usage; not model-only memory"})


def upload(owner, reference, filename):
    data = checked(reference["path"], reference["sha256"])
    boundary = "NF_QA_" + uuid.uuid4().hex
    chunks = []
    for name, value in (("type", "input"), ("subfolder", "layer-window-probe"), ("overwrite", "false")):
        chunks.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    chunks.extend([f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n".encode(), data, f"\r\n--{boundary}--\r\n".encode()])
    owner.assert_listener_owned()
    request = urllib.request.Request(URL + "/upload/image", data=b"".join(chunks), headers={"Content-Type": "multipart/form-data; boundary=" + boundary})
    with OPENER.open(request, timeout=30) as response:
        result = json.loads(response.read())
    if result.get("type") != "input":
        raise RuntimeError("Upload did not resolve to isolated input")
    local = resolve_under(BASE / "input", result.get("subfolder", ""), result["name"])
    checked(local, reference["sha256"])
    return {**reference, "upload": result, "localPath": str(local), "graphName": "/".join(filter(None, [result.get("subfolder"), result["name"]]))}


def log_parts():
    return {name: (HERE / name).stat().st_size for name in ("stdout.log", "stderr.log")}


def wait_history(owner, guard, prompt_id, timeout, folder):
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        guard.check()
        history = owner.call("/history/" + urllib.parse.quote(prompt_id))
        item = history.get(prompt_id)
        if item:
            status = item.get("status", {})
            if status.get("status_str") == "error":
                save(folder / "history.json", history, exclusive=True)
                raise RuntimeError("Actual Comfy history error: " + json.dumps(status))
            if status.get("completed") and status.get("status_str") == "success":
                return history, time.monotonic() - start
        # Absence from /queue is not failure; completed history can lag queue removal.
        time.sleep(0.8)
    raise TimeoutError("Owned generation exceeded timeout; no retry")


def release_between_jobs(owner, guard, idle_vram, timeout=60):
    at = time.monotonic()
    ack = owner.call("/free", {"unload_models": True, "free_memory": True})
    idle_count = 0
    while time.monotonic() - at < timeout:
        guard.check()
        queue = owner.call("/queue")
        sample = guard.latest
        idle = not queue.get("queue_running") and not queue.get("queue_pending") and sample and sample["vramUsedMiB"] <= idle_vram + 768
        idle_count = idle_count + 1 if idle else 0
        if idle_count >= 2:
            return {"ack": ack, "queue": queue, "resourceSample": sample, "seconds": time.monotonic() - at,
                    "criterion": "queue idle and device VRAM <= ready-idle baseline + 768 MiB for two polls; not a zero-memory claim"}
        time.sleep(1)
    raise RuntimeError("Owned /free did not reach idle headroom; stop rather than run the next job")
