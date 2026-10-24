"""Prepare or explicitly run four isolated ComfyUI layer-window QA jobs.

Default and --preflight-only NEVER start a server or inference. Only --run starts
the owned 8192 child. Existing ComfyUI/AI endpoints are queried read-only.
"""
from __future__ import annotations

import argparse
import ast
import copy
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse
import urllib.request
import uuid

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent
REPO = RESEARCH.parent.parent
AB = REPO / "work/qwen38-strata-deploy-20261024/adapted-ab"
PROTO = RESEARCH / "prototype_frequency_layers_v2"
ENGINE = Path("C:/ProgramData/NovaFlow/AI-Runtime/engine")
PYTHON = ENGINE / "python/python.exe"
COMFY = ENGINE / "ComfyUI"
BASE = HERE / "comfy-root"
PORT = 8192
URL = "http://127.0.0.1:8192"
NODE = "NovaFlowQwen21StyleKeyLayerWindowExperimental"
NODE_ID = "901"
WHITELIST = ["ComfyUI-GGUF-leejet", "novaflow_qwen_bf16_loader", PROTO.name]
PINNED_PROTO = {
    "__init__.py": "c5b3f3b59042a3c1742343c1a8564ae54b2a9ba17e264acb660d120576c45e25",
    "reference_frequency_layers.py": "ff04b5547da3695b99dc2cd06e80de030e123641268fd454dc5dfa05e4210b4a",
    "frequency_core.py": "6e032007203717d286cfeaeaa2d78cdbbdec7211ace56c45bbab4a044b3f3b2c",
    "layout.py": "b5934f24fa8a6aa02e7d2c75c5fb105866c9fbb011be5e5171ad696de9b18d24",
}
PARAMS = {"style_reference_index": 1, "high_scale": 0.5, "low_scale": 1.5,
          "beta": 2.0, "layer_start": 24, "layer_end": 31, "audit_log": True,
          "cap_amplification": False, "active_sigma_min": 0.0}
SIGMAS = "1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0"
BASELINES = {
    "bright": {"case": "bright-balanced-cache-v3-formal", "graph_sha256": "b150db9cde0193a20d8a3cd76f89730e5c53ed041b9a0771e41d92f851733562",
               "case_sha256": "0746ee96c40e0fd73604e22b76a42bdc7a9f7f80eff4ed77761115dd8102657a",
               "prompt_sha256": "e51eb53b517e3dffe2a65aec47a7e6ae6e7cf5355932843919fe77e663f6134c",
               "output_sha256": "674dcfc105eb2799b4ec72e63b64904af3993b86a9295a2cbbc57f97c45c7312"},
    "dark": {"case": "dark-r10-formal", "graph_sha256": "5ece70d7579b64d3a17649d1f8186205a38f1b0dc6bec3328c29d1da29c335f2",
             "case_sha256": "06f04b4eedab45b38fffac5c56037a43797e2be96eed93a85d96dd9dcc73307c",
             "prompt_sha256": "b646f0e734db3b7a600f9c509a728bb9e747e0943de6db75be3f0fbcbee26af2",
             "output_sha256": "8bbbd360216faa49629ff964b724962914ed6b5b85b0fe775ffc97f4eb0d0fc3"},
}
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
FATAL_GPU = re.compile(r"illegal memory access|device-side assert|device (?:is )?lost|fallen off the bus|driver shutting down|unspecified launch failure|CUDA out of memory|NVRM.*Xid", re.I)


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


def prototype_schema():
    manifest = read(PROTO / "package-manifest.json")
    if not manifest.get("tests_passed") or manifest.get("tests_run") != 16 or manifest.get("node") != NODE:
        raise RuntimeError("Prototype has no finalized 16-pass CPU receipt")
    for name, expected in manifest["files"].items():
        checked(PROTO / name, expected)
    for name, expected in PINNED_PROTO.items():
        checked(PROTO / name, expected)
    module = ast.parse((PROTO / "reference_frequency_layers.py").read_text(encoding="utf-8"))
    cls = next(n for n in module.body if isinstance(n, ast.ClassDef) and n.name == NODE)
    fn = next(n for n in cls.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "INPUT_TYPES")
    schema = ast.literal_eval(next(n.value for n in fn.body if isinstance(n, ast.Return)))
    expected = {"model", "enabled", *PARAMS}
    if set(schema["required"]) | set(schema.get("optional", {})) != expected:
        raise RuntimeError("Unexpected INPUT_TYPES; do not invent node parameters")
    return manifest, json.loads(json.dumps(schema))


def baseline(style):
    pin = BASELINES[style]
    folder = AB / pin["case"]
    graph = json.loads(checked(folder / "generation-flash/graph.json", pin["graph_sha256"]))
    case = json.loads(checked(folder / "case.json", pin["case_sha256"]))
    prompt = checked(folder / "generation-flash/prompt.txt", pin["prompt_sha256"]).decode("utf-8")
    if graph["5"]["inputs"]["prompt"] != prompt:
        raise RuntimeError("Baseline graph/prompt differs")
    result = read(folder / "generation-flash/result.json")
    checked(result["outputs"][0]["path"], pin["output_sha256"])
    if graph["7"]["inputs"]["cfg"] != 3 or graph["7"]["inputs"]["noise_seed"] != 54792256:
        raise RuntimeError("Baseline is not frozen CFG3/seed")
    if graph["nf_turbo_7_sigmas"]["inputs"]["sigmas"] != SIGMAS:
        raise RuntimeError("Baseline sigmas changed")
    if graph["7"]["inputs"]["model"] != ["4", 0] or NODE_ID in graph:
        raise RuntimeError("Unexpected model cache chain")
    if graph["7"]["inputs"]["latent_image"] != ["5", 2] or graph["5"]["inputs"]["images.image_1"] != ["100", 0]:
        raise RuntimeError("Source/latent geometry changed")
    references = []
    previous_refs = read(folder / "generation-flash/provenance.json")["references"]
    for index, image in enumerate(case["images"]):
        path = Path(image.get("originalPath", image["path"]))
        expected = image.get("originalSHA256", image["sha256"])
        data = checked(path, expected)
        if previous_refs[index]["sha256"] != expected:
            raise RuntimeError("Original generation references differ from case")
        references.append({"path": str(path), "sha256": expected, "bytes": len(data), "role": "source" if index == 0 else "style"})
    return {"style": style, "folder": str(folder), "pin": pin, "graph": graph, "case": case, "references": references}


def protected_snapshot():
    dark = AB / "accepted-dark-r10"
    manifest = read(dark / "manifest.json")
    if len(manifest["files"]) != 13:
        raise RuntimeError("Frozen Dark receipt changed")
    records = {}
    for item in manifest["files"]:
        for path in (dark / item["file"], Path(item["copiedFrom"])):
            checked(path, item["sha256"])
            records[str(path.resolve())] = item["sha256"]
    for path in (dark / "manifest.json", RESEARCH / "gallery-20261024/manifest.json", RESEARCH / "gallery-20261024/data.js"):
        records[str(path.resolve())] = digest(path.read_bytes())
    return records


def preflight():
    if os.name != "nt":
        raise RuntimeError("This owned-process QA runner is Windows-only")
    for sentinel in ("load.json", "result.json", "owned-server.json"):
        if (HERE / sentinel).exists():
            raise RuntimeError(f"Prior execution receipt exists: {sentinel}; refuse rerun")
    for file in (PYTHON, COMFY / "main.py", COMFY / "comfy/cli_args.py"):
        if not file.is_file():
            raise RuntimeError(f"Required runtime is absent: {file}")
    cli = (COMFY / "comfy/cli_args.py").read_text(encoding="utf-8")
    for flag in ("--base-directory", "--whitelist-custom-nodes", "--disable-all-custom-nodes", "--disable-api-nodes"):
        if flag not in cli:
            raise RuntimeError(f"Current Comfy CLI lacks {flag}")
    if port_open(PORT):
        raise RuntimeError("8192 is already owned; do not restart or interrupt it")
    services = other_services_idle()
    manifest, schema = prototype_schema()
    frozen = {style: baseline(style) for style in ("bright", "dark")}
    for part in ("input", "output", "temp", "user", "models", "custom_nodes", "cache"):
        resolve_under(BASE, part).mkdir(parents=True, exist_ok=True)
    staged = resolve_under(BASE, "custom_nodes", PROTO.name)
    staged.mkdir(parents=True, exist_ok=True)
    for name in (*PINNED_PROTO, "LICENSE", "NOTICE.md", "ORIGIN.json"):
        expected = manifest["files"][name]
        data = checked(PROTO / name, expected)
        dest = resolve_under(staged, name)
        if dest.exists():
            checked(dest, expected)
        else:
            with dest.open("xb") as file:
                file.write(data)
        checked(dest, expected)
    unexpected = [p.name for p in staged.iterdir() if p.name not in {*PINNED_PROTO, "LICENSE", "NOTICE.md", "ORIGIN.json"}]
    if unexpected:
        raise RuntimeError(f"Unexpected files in isolated prototype: {unexpected}")
    known_packages = []
    for name in WHITELIST[:2]:
        package = Path("E:/NovaFlow/custom_nodes") / name
        if not (package / "__init__.py").is_file():
            raise RuntimeError(f"Known loader absent: {package}")
        known_packages.append({"path": str(package), "pythonFiles": {str(p.relative_to(package)): digest(p.read_bytes()) for p in sorted(package.rglob("*.py"))}})
    paths = {
        "existing_model_weights_readonly": {"base_path": "E:/NovaFlow/models", "is_default": True,
            "diffusion_models": "diffusion_models\nunet", "unet": "diffusion_models\nunet",
            "text_encoders": "text_encoders\nclip", "clip": "text_encoders\nclip", "vae": "vae"},
        "known_loaders_readonly": {"base_path": "E:/NovaFlow/custom_nodes", "custom_nodes": "."},
    }
    # JSON is valid YAML, avoiding a separate preparation-time parser dependency.
    save(HERE / "extra-model-paths.yaml", paths)
    model_files = []
    for name, directories in (("Qwen-Image-2.1-Turbo-BF16.gguf", ("diffusion_models", "unet")),
                              ("qwen3vl_8b_bf16_heretic.safetensors", ("text_encoders", "clip")),
                              ("qwen_image_2.1_vae_bf16.safetensors", ("vae",))):
        choices = [Path("E:/NovaFlow/models") / d / name for d in directories]
        path = next((p for p in choices if p.is_file()), None)
        if path is None:
            raise RuntimeError(f"Model absent from known paths: {name}")
        model_files.append({"path": str(path), "bytes": path.stat().st_size, "mtimeNs": path.stat().st_mtime_ns,
                            "liveMultiGBSHARecomputed": False})
    nvidia = shutil.which("nvidia-smi") or shutil.which("nvidia-smi.exe")
    if not nvidia:
        raise RuntimeError("nvidia-smi is required for resource/driver monitoring")
    protected = protected_snapshot()
    command = [str(PYTHON), "-s", "-B", str(COMFY / "main.py"), "--listen", "127.0.0.1", "--port", str(PORT),
        "--base-directory", str(BASE), "--extra-model-paths-config", str(HERE / "extra-model-paths.yaml"),
        "--input-directory", str(BASE / "input"), "--output-directory", str(BASE / "output"),
        "--temp-directory", str(BASE / "temp"), "--user-directory", str(BASE / "user"),
        "--disable-auto-launch", "--disable-api-nodes", "--disable-all-custom-nodes", "--whitelist-custom-nodes", *WHITELIST]
    report = {"ok": True, "preflightOnly": True, "serverStarted": False, "gpuInferenceStarted": False,
        "port": PORT, "command": command, "baseDirectory": str(BASE), "prototype": {"source": str(PROTO), "staged": str(staged),
        "files": PINNED_PROTO, "packageManifestSHA256": digest((PROTO / "package-manifest.json").read_bytes()), "cpuTestsPassed": 16, "INPUT_TYPES": schema},
        "jobOrder": ["bright-off", "bright-on", "dark-off", "dark-on"], "nodeParameters": PARAMS,
        "existingServicesReadOnly": services, "knownLoaderPythonFiles": known_packages, "modelFiles": model_files,
        "baselines": {s: {"pin": b["pin"], "references": b["references"]} for s, b in frozen.items()},
        "protectedFiles": protected, "nvidiaSmi": nvidia,
        "runtimeFiles": {str(p): digest(p.read_bytes()) for p in (COMFY / "main.py", COMFY / "comfy/cli_args.py", COMFY / "folder_paths.py")}}
    save(HERE / "preflight.json", report)
    return report, frozen, schema


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


def validate_catalog(catalog, frozen, schema):
    if NODE not in catalog or catalog[NODE].get("input") != schema or catalog[NODE].get("output") != ["MODEL"]:
        raise RuntimeError("Live experimental class INPUT_TYPES/output differs from frozen Python schema")
    needed = {node["class_type"] for b in frozen.values() for node in b["graph"].values()}
    if needed - set(catalog):
        raise RuntimeError("Live catalog lacks baseline nodes: " + str(needed - set(catalog)))
    for cls, key, name in (("NovaFlowGGUFBF16Loader", "unet_name", "Qwen-Image-2.1-Turbo-BF16.gguf"),
                           ("CLIPLoader", "clip_name", "qwen3vl_8b_bf16_heretic.safetensors"),
                           ("VAELoader", "vae_name", "qwen_image_2.1_vae_bf16.safetensors")):
        values = catalog[cls]["input"]["required"][key][0]
        if not isinstance(values, list) or name not in values:
            raise RuntimeError(f"Live {cls} cannot resolve required model {name}")


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


def audit_job_logs(start, target, enabled):
    audits = []
    for name, offset in start.items():
        with (HERE / name).open("rb") as file:
            file.seek(offset)
            text = file.read().decode("utf-8", errors="replace")
        (target / name).write_text(text, encoding="utf-8")
        for line in text.splitlines():
            marker = "Qwen21StyleKeyLayerWindow audit="
            if marker in line:
                content = line.split(marker, 1)[1]
                audits.append(json.loads(content[:content.rfind("}") + 1]))
    save(target / "actual-node-audit.json", audits)
    if enabled:
        if not audits:
            raise RuntimeError("Enabled node has no actual runtime audit")
        last = audits[-1]
        if set(map(int, last["selected_target_by_layer"])) != set(range(24, 32)):
            raise RuntimeError("Actual selected target layers differ from 24..31")
        if set(map(int, last["bypassed_target_by_layer"])) != set(range(24)):
            raise RuntimeError("Actual unselected target layers were not bypassed")
        for audit in audits:
            if audit["key_copies_this_forward"] != 8 or audit["actual_num_layers"] != 32 or audit["axis0_scale"] != 1.0 or audit["style_reference_index"] != 1:
                raise RuntimeError("Runtime audit violates eight-layer/style-slot contract")
            if audit["preferred_backend_check"]["non_null_count"] != 0:
                raise RuntimeError("Native preferred attention backend was overridden")
        return {"auditLines": len(audits), "last": last, "actualSelectedLayersVerified": True}
    if audits:
        raise RuntimeError("OFF job unexpectedly used the experimental wrapper")
    return {"auditLines": 0, "disabledModelIdentityPath": True}


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


def run_job(owner, guard, frozen, style, enabled, idle_vram, timeout):
    from PIL import Image
    key = style + ("-on" if enabled else "-off")
    folder = HERE / "jobs" / key
    folder.mkdir(parents=True, exist_ok=False)
    start = time.monotonic()
    offsets = log_parts()
    other_services_idle()
    refs = [upload(owner, ref, "NF_LW_" + key + "_" + ref["role"] + Path(ref["path"]).suffix.lower()) for ref in frozen["references"]]
    graph = copy.deepcopy(frozen["graph"])
    graph[NODE_ID] = {"class_type": NODE, "inputs": {"model": ["4", 0], "enabled": enabled, **PARAMS}}
    graph["7"]["inputs"]["model"] = [NODE_ID, 0]
    graph["100"]["inputs"]["image"], graph["101"]["inputs"]["image"] = [ref["graphName"] for ref in refs]
    graph["10"]["inputs"]["filename_prefix"] = "NF_LAYER_WINDOW_" + key.replace("-", "_")
    changes = graph_differences(frozen["graph"], graph)
    allowed = {NODE_ID, "7.inputs.model", "100.inputs.image", "101.inputs.image", "10.inputs.filename_prefix"}
    if set(changes) != allowed:
        raise RuntimeError("Unexpected changes to frozen prompt/negative/sampling/geometry: " + str(changes))
    save(folder / "graph.json", graph, exclusive=True)
    save(folder / "references.json", refs, exclusive=True)
    save(folder / "graph-diff-proof.json", {"baseline": frozen["pin"], "actualDifferences": changes, "onlyExperimentalModelNodeAndFileNamesChanged": True}, exclusive=True)
    enqueue_at = time.monotonic()
    queued = owner.call("/prompt", {"prompt": graph, "client_id": "nf-layer-window-owned-qa", "extra_data": {"qa_job": key}})
    save(folder / "queued.json", queued, exclusive=True)
    prompt_id = queued.get("prompt_id")
    if not prompt_id or queued.get("node_errors"):
        raise RuntimeError("Actual prompt validation failed: " + json.dumps(queued))
    history, _ = wait_history(owner, guard, prompt_id, timeout, folder)
    completed_at = time.monotonic()
    save(folder / "history.json", history, exclusive=True)
    item = history[prompt_id]
    if item["prompt"][2] != graph:
        raise RuntimeError("Actual history does not match the exact submitted graph")
    images = item.get("outputs", {}).get("10", {}).get("images", [])
    if len(images) != 1 or images[0].get("type") != "output":
        raise RuntimeError("Expected exactly one actual SaveImage output")
    image = images[0]
    original_output = resolve_under(BASE / "output", image.get("subfolder", ""), image["filename"])
    query = urllib.parse.urlencode({"filename": image["filename"], "subfolder": image.get("subfolder", ""), "type": "output"})
    pixels = owner.call("/view?" + query, raw=True, timeout=30)
    if original_output.read_bytes() != pixels:
        raise RuntimeError("HTTP output and isolated output-file bytes differ")
    output = folder / "output.png"
    with output.open("xb") as file:
        file.write(pixels)
    with Image.open(output) as decoded:
        if decoded.size != (1280, 960):
            raise RuntimeError("Actual output canvas changed")
        rgba = decoded.convert("RGBA").tobytes()
    release = release_between_jobs(owner, guard, idle_vram)
    save(folder / "release.json", release, exclusive=True)
    audit = audit_job_logs(offsets, folder, enabled)
    result = {"ok": True, "job": key, "promptId": prompt_id, "enabled": enabled, "style": style,
        "newAIAnalysis": False, "additionalAIAnalysisSeconds": 0, "promptSource": "unchanged-baseline-native-prompt",
        "baseline": frozen["pin"], "nodeInputs": graph[NODE_ID]["inputs"], "graphSHA256": digest((folder / "graph.json").read_bytes()),
        "output": {"path": str(output), "isolatedServerOutput": str(original_output), "sha256": digest(pixels),
                   "decodedRGBA_SHA256": digest(rgba), "width": 1280, "height": 960}, "actualNodeAudit": audit,
        "uploadSeconds": enqueue_at - start, "enqueueToSuccessfulHistorySeconds": completed_at - enqueue_at,
        "individualJobFullSeconds": time.monotonic() - start, "includesUploadDownloadAndFree": True,
        "timingIsNodeSpeedupEvidence": False, "coldWarmEffectsNotControlled": True,
        "qualityAccepted": False, "referenceStyleAccepted": False, "formalDefaultChanged": False}
    save(folder / "result.json", result, exclusive=True)
    emit("job-complete", job=key, promptId=prompt_id, seconds=result["individualJobFullSeconds"], outputSHA256=digest(pixels))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--preflight-only", action="store_true", help="Read-only endpoint checks and idempotent isolated file preparation; no server/inference")
    mode.add_argument("--run", action="store_true", help="Explicitly start the owned server and run Bright OFF/ON then Dark OFF/ON")
    parser.add_argument("--job-timeout", type=int, default=1200)
    parser.add_argument("--startup-timeout", type=int, default=150)
    parser.add_argument("--min-ram-gib", type=float, default=3.0)
    parser.add_argument("--min-vram-free-mib", type=int, default=384)
    parser.add_argument("--low-headroom-seconds", type=float, default=5.0)
    options = parser.parse_args()
    if min(options.job_timeout, options.startup_timeout, options.min_ram_gib, options.min_vram_free_mib, options.low_headroom_seconds) <= 0:
        parser.error("Limits must be positive")
    report, frozen, schema = preflight()
    emit("preflight-complete", serverStarted=False, GPUInferenceStarted=False, command=report["command"])
    if not options.run:
        return 0
    import psutil  # CPU process/RAM inspection; never import torch in this runner.
    owner = OwnedServer(psutil, report["command"])
    guard = ResourceGuard(psutil, report["nvidiaSmi"], owner, options)
    result = {"ok": False, "serverPort": PORT, "newAIAnalysis": False, "jobs": [], "formalDefaultChanged": False, "qualityAccepted": False,
              "timingIsNodeSpeedupEvidence": False, "coldWarmEffectsNotControlled": True, "startedAt": time.time()}
    started = time.monotonic()
    try:
        guard.thread.start()
        # A first resource sample must succeed before any Comfy child can start.
        first_deadline = time.monotonic() + 10
        while guard.latest is None and time.monotonic() < first_deadline:
            guard.check()
            time.sleep(0.1)
        guard.check()
        if guard.latest is None:
            raise RuntimeError("No resource sample; server not started")
        owner.start()
        ready_at = time.monotonic() + options.startup_timeout
        catalog = None
        while time.monotonic() < ready_at:
            guard.check()
            owner.assert_owned()
            if port_open(PORT):
                catalog = owner.call("/object_info", timeout=20)
                break
            time.sleep(0.5)
        if catalog is None:
            raise TimeoutError("Owned server startup timed out")
        validate_catalog(catalog, frozen, schema)
        save(HERE / "object-info.json", catalog, exclusive=True)
        save(HERE / "load.json", {**read(HERE / "load.json"), "ready": True, "readyAfterSeconds": time.monotonic() - started,
            "objectInfoSHA256": digest((HERE / "object-info.json").read_bytes()), "actualClassAndModelCatalogVerified": True})
        idle_vram = guard.latest["vramUsedMiB"]
        emit("owned-server-ready", pid=owner.process.pid, idleVRAMMiB=idle_vram)
        for style, enabled in (("bright", False), ("bright", True), ("dark", False), ("dark", True)):
            guard.check()
            result["jobs"].append(run_job(owner, guard, frozen[style], style, enabled, idle_vram, options.job_timeout))
        result["ok"] = True
    except BaseException as exc:
        result.update(error=str(exc), exceptionType=type(exc).__name__, traceback=traceback.format_exc())
        emit("qa-failed-no-retry", error=str(exc))
    finally:
        if owner.process and owner.process.poll() is None:
            try:
                owner.call("/interrupt", {}, timeout=3)
                owner.call("/free", {"unload_models": True, "free_memory": True}, timeout=3)
            except Exception as exc:
                result["finalHTTPReleaseError"] = str(exc)
        try:
            cleanup = owner.stop()
        except Exception as exc:
            cleanup = {"cleanupError": str(exc), "ownedPID": owner.process.pid if owner.process else None}
            result["ok"] = False
        result["ownedProcessCleanup"] = cleanup
        guard.close()
        result["resourceAbortReason"] = guard.reason
        if guard.reason or cleanup.get("remainingOwnedIdentities"):
            result["ok"] = False
        for path, expected in report["protectedFiles"].items():
            try:
                checked(path, expected)
            except Exception as exc:
                result["ok"] = False
                result.setdefault("protectedFileErrors", []).append(str(exc))
        for package in report["knownLoaderPythonFiles"]:
            for relative, expected in package["pythonFiles"].items():
                try:
                    checked(Path(package["path"]) / relative, expected)
                except Exception as exc:
                    result["ok"] = False
                    result.setdefault("externalLoaderMutationErrors", []).append(str(exc))
        result.update(totalOwnedRunSeconds=time.monotonic() - started, endedAt=time.time(), existingServicesWereNeverMutated=True,
                      galleryChanged=False, productionDefaultChanged=False)
        save(HERE / "result.json", result, exclusive=True)
        save(HERE / "owned-stop.json", cleanup, exclusive=True)
        emit("qa-finished", ok=result["ok"], completedJobs=len(result["jobs"]), resultPath=str(HERE / "result.json"))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
