const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const previewPath = path.join(root, "tools", "preview_runtime_server.py");
const previewSource = fs.readFileSync(previewPath, "utf8");
const mainSource = fs.readFileSync(path.join(root, "particle-editor-desktop", "main.js"), "utf8");

assert.match(mainSource, /__novaflowStartupStdoutBuffer \+= text[\s\S]*?startup\?\.type === "ready"/);
assert.match(mainSource, /startup\?\.type !== "startup-error"[\s\S]*?prompt-assistant-startup-error/);
assert.match(mainSource, /Number\(code\) === 73[\s\S]*?prompt-assistant-already-running/);
assert.match(mainSource, /remainingMs = optimizeTimeoutMs - \(Date\.now\(\) - startedAt\) - 18_500/);
assert.match(previewSource, /def _handle_prompt_assistant\(self, send_body: bool = True\) -> None:\s+optimize_started = time\.monotonic\(\)/);
assert.match(previewSource, /ordinary_art_deadline = optimize_started \+ 300\.0/);
assert.match(previewSource, /ordinary_art_inference_deadline = ordinary_art_deadline - 5\.5/);
assert.match(previewSource, /ordinary_art_lock_acquired = PROMPT_ASSISTANT_LOCK\.acquire\(blocking=False\)/);
assert.match(previewSource, /remaining_seconds = 300 - \(time\.monotonic\(\) - optimize_started\) - 18\.5/);
assert.match(previewSource, /lock_already_held=ordinary_art_prompt_patch,\s+deadline_monotonic=ordinary_art_inference_deadline/);
assert.match(previewSource, /finally:\s+if ordinary_art_lock_acquired:\s+PROMPT_ASSISTANT_LOCK\.release\(\)/);
assert.match(previewSource, /ordinary_art_prompt_patch and stop_result == "stop-timeout"[\s\S]*?prompt-assistant-stop-timeout/);
assert.match(previewSource, /def _prompt_assistant_child_process_alive\([\s\S]*?_prompt_assistant_process_pid_alive\(pid\)/);
assert.match(previewSource, /stop_result = _stop_prompt_assistant_process\(\)[\s\S]*?if stop_result == "stop-timeout"[\s\S]*?prompt-assistant-stop-timeout/);

const probe = String.raw`
import errno, importlib.util, json, os, pathlib, queue, subprocess, sys
spec = importlib.util.spec_from_file_location("preview_resource_contract", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

if os.name == "nt":
    assert m._prompt_assistant_windows_process_alive(os.getpid()) is True
assert m._prompt_assistant_windows_process_alive(0) is False
class BrokenKernel32:
    @property
    def OpenProcess(self): raise SystemError("ctypes probe failed")
assert m._prompt_assistant_windows_process_alive(12345, BrokenKernel32()) is None

old_inspect=m._inspect_prompt_assistant_runtime_queue
old_alive=m._prompt_assistant_runtime_process_alive
old_free=m._request_prompt_assistant_runtime_free_memory
alive_calls=[]
m._prompt_assistant_runtime_process_alive=lambda:alive_calls.append(True) or True
m._inspect_prompt_assistant_runtime_queue=lambda _:{"ok":True,"available":True,"state":"idle","running":0,"pending":0}
m._request_prompt_assistant_runtime_free_memory=lambda _:{"ok":True}
assert m._prepare_prompt_assistant_resource_handoff("http://127.0.0.1:8188")["ok"] is True
assert alive_calls == []
m._inspect_prompt_assistant_runtime_queue=lambda _:{"ok":False,"available":False,"state":"no-listener","noListener":True}
m._prompt_assistant_runtime_process_alive=lambda:None
unknown=m._prepare_prompt_assistant_resource_handoff("http://127.0.0.1:8188")
assert unknown["ok"] is False and unknown["errorCode"]=="runtime-queue-indeterminate"
m._inspect_prompt_assistant_runtime_queue=old_inspect; m._prompt_assistant_runtime_process_alive=old_alive; m._request_prompt_assistant_runtime_free_memory=old_free

class In:
    def __init__(self): self.lines=[]
    def write(self,v): self.lines.append(v)
    def flush(self): pass
    def close(self): pass
class Proc:
    def __init__(self, code=None, unstoppable=False):
        self.stdin=In(); self.stdout=[]; self.stderr=[]; self.returncode=code; self.unstoppable=unstoppable
    def poll(self): return self.returncode
    def wait(self, timeout=None):
        if self.unstoppable: raise subprocess.TimeoutExpired("pa", timeout)
        self.returncode=0 if self.returncode is None else self.returncode; return self.returncode
    def terminate(self):
        if not self.unstoppable: self.returncode=0
    def kill(self):
        if not self.unstoppable: self.returncode=-9
class Thread:
    line=""
    def __init__(self,target=None,args=(),daemon=None): self.target=target; self.args=args
    def start(self):
        if self.target is m._drain_prompt_assistant_stdout and self.line: self.args[1].put(self.line)

m._prompt_assistant_config=lambda:{"enabled":True,"serviceExists":True,"modelExists":True,"runtimeConfig":{},"pythonPath":sys.executable,"serviceScript":sys.argv[1],"modelPath":"m","reverseModelPath":"r","reverseModelType":"r"}
old_popen=m.subprocess.Popen; old_thread=m.threading.Thread
m.threading.Thread=Thread
Thread.line=json.dumps({"type":"startup-error","errorCode":"prompt-assistant-already-running","error":"busy"})
m.subprocess.Popen=lambda *a,**k:Proc()
try: m._ensure_prompt_assistant_process(); raise AssertionError("startup-error accepted")
except m.PromptAssistantStartupError as e: assert e.error_code=="prompt-assistant-already-running"
m.PROMPT_ASSISTANT_PROCESS=None; m.PROMPT_ASSISTANT_STDOUT_QUEUE=None; Thread.line=""
m.subprocess.Popen=lambda *a,**k:Proc(73)
try: m._ensure_prompt_assistant_process(); raise AssertionError("exit73 accepted")
except m.PromptAssistantStartupError as e: assert e.error_code=="prompt-assistant-already-running"
m.subprocess.Popen=old_popen; m.threading.Thread=old_thread

stuck=Proc(unstoppable=True); m.PROMPT_ASSISTANT_PROCESS=stuck; m.PROMPT_ASSISTANT_STDOUT_QUEUE=queue.Queue()
assert m._stop_prompt_assistant_process(.5)=="stop-timeout" and m.PROMPT_ASSISTANT_PROCESS is stuck
m.PROMPT_ASSISTANT_PROCESS=None; m.PROMPT_ASSISTANT_STDOUT_QUEUE=None

class InvalidHandleProc(Proc):
    def __init__(self, pid=87654):
        super().__init__(); self.pid=pid
    def poll(self): raise OSError(errno.EINVAL, "Invalid argument")
    def wait(self, timeout=None): raise OSError(errno.EINVAL, "Invalid argument")
    def terminate(self): raise OSError(errno.EINVAL, "Invalid argument")
    def kill(self): raise OSError(errno.EINVAL, "Invalid argument")

old_pid_alive=m._prompt_assistant_process_pid_alive
m._prompt_assistant_process_pid_alive=lambda _pid:False
dead_invalid=InvalidHandleProc(); m.PROMPT_ASSISTANT_PROCESS=dead_invalid; m.PROMPT_ASSISTANT_STDOUT_QUEUE=queue.Queue()
assert m._stop_prompt_assistant_process(.5)=="stopped"
assert m.PROMPT_ASSISTANT_PROCESS is None and m.PROMPT_ASSISTANT_STDOUT_QUEUE is None

for uncertain_state in (True, None):
    m._prompt_assistant_process_pid_alive=lambda _pid,state=uncertain_state:state
    retained_invalid=InvalidHandleProc(); m.PROMPT_ASSISTANT_PROCESS=retained_invalid; m.PROMPT_ASSISTANT_STDOUT_QUEUE=queue.Queue()
    assert m._stop_prompt_assistant_process(.5)=="stop-timeout"
    assert m.PROMPT_ASSISTANT_PROCESS is retained_invalid
    m.PROMPT_ASSISTANT_PROCESS=None; m.PROMPT_ASSISTANT_STDOUT_QUEUE=None

spawned=[]
m._prompt_assistant_process_pid_alive=lambda _pid:False
m.PROMPT_ASSISTANT_PROCESS=InvalidHandleProc(); m.PROMPT_ASSISTANT_STDOUT_QUEUE=queue.Queue()
m.PROMPT_ASSISTANT_STDERR_TAIL=["old 154s generation tail"]
Thread.line=json.dumps({"type":"ready"})
m.threading.Thread=Thread
m.subprocess.Popen=lambda *a,**k:spawned.append(True) or Proc()
fresh_proc,fresh_queue=m._ensure_prompt_assistant_process()
assert len(spawned)==1 and fresh_proc is m.PROMPT_ASSISTANT_PROCESS and fresh_queue is m.PROMPT_ASSISTANT_STDOUT_QUEUE
assert "old 154s generation tail" not in m._prompt_assistant_stderr_text()
assert m._stop_prompt_assistant_process(.5)=="stopped"

for uncertain_state in (True, None):
    spawned.clear(); m._prompt_assistant_process_pid_alive=lambda _pid,state=uncertain_state:state
    retained_invalid=InvalidHandleProc(); m.PROMPT_ASSISTANT_PROCESS=retained_invalid; m.PROMPT_ASSISTANT_STDOUT_QUEUE=None
    m.subprocess.Popen=lambda *a,**k:spawned.append(True) or Proc()
    try: m._ensure_prompt_assistant_process(); raise AssertionError("indeterminate stale process accepted")
    except m.PromptAssistantStartupError as e: assert e.error_code=="prompt-assistant-stop-timeout"
    assert spawned==[] and m.PROMPT_ASSISTANT_PROCESS is retained_invalid
    m.PROMPT_ASSISTANT_PROCESS=None; m.PROMPT_ASSISTANT_STDOUT_QUEUE=None

spawned.clear(); stuck=Proc(unstoppable=True); m.PROMPT_ASSISTANT_PROCESS=stuck; m.PROMPT_ASSISTANT_STDOUT_QUEUE=None
m.subprocess.Popen=lambda *a,**k:spawned.append(True) or Proc()
try: m._ensure_prompt_assistant_process(); raise AssertionError("stop-timeout spawned a second child")
except m.PromptAssistantStartupError as e: assert e.error_code=="prompt-assistant-stop-timeout"
assert spawned==[] and m.PROMPT_ASSISTANT_PROCESS is stuck
m.PROMPT_ASSISTANT_PROCESS=None; m.PROMPT_ASSISTANT_STDOUT_QUEUE=None

real_request=m._request_prompt_assistant; real_handoff=m._prepare_prompt_assistant_resource_handoff
m._prompt_assistant_process_pid_alive=lambda _pid:False
m._prepare_prompt_assistant_resource_handoff=lambda _:{"ok":True,"state":"runtime-memory-released","released":True}
def successful_request_with_dead_cleanup(*_args,**_kwargs):
    m.PROMPT_ASSISTANT_PROCESS=InvalidHandleProc(); m.PROMPT_ASSISTANT_STDOUT_QUEUE=queue.Queue()
    return {"ok":True,"data":{"positivePrompt":"ok"}}
m._request_prompt_assistant=successful_request_with_dead_cleanup
h=object.__new__(m.PreviewRuntimeHandler); h.path=m.PROMPT_ASSISTANT_PATH+"/optimize-prompt"; h._default_base_url="http://127.0.0.1:8188"
h._read_request_body=lambda:json.dumps({"prompt":"base","currentPrompt":"base","purpose":"optimize","surface":"art","provider":"local","supportsNegativePrompt":False}).encode()
handler_out=[]; h._write_json_response=lambda status,body:handler_out.append((status,body)); h._handle_prompt_assistant()
assert handler_out[-1][0]==200 and handler_out[-1][1]["data"]["positivePrompt"]=="ok"
assert m.PROMPT_ASSISTANT_PROCESS is None and m.PROMPT_ASSISTANT_STDOUT_QUEUE is None
m._request_prompt_assistant=real_request; m._prepare_prompt_assistant_resource_handoff=real_handoff

real_ensure=m._ensure_prompt_assistant_process
midflight_proc=InvalidHandleProc(); midflight_queue=queue.Queue()
m._ensure_prompt_assistant_process=lambda **_kwargs:(midflight_proc,midflight_queue)
m.PROMPT_ASSISTANT_PROCESS=midflight_proc; m.PROMPT_ASSISTANT_STDOUT_QUEUE=midflight_queue
try:
    m._request_prompt_assistant("optimizePrompt", {"prompt":"base"}, timeout=1)
    raise AssertionError("dead invalid handle accepted mid-response")
except RuntimeError as e:
    assert "服务已退出" in str(e) and "Errno 22" not in str(e)
assert m.PROMPT_ASSISTANT_PROCESS is None and m.PROMPT_ASSISTANT_STDOUT_QUEUE is None

m._ensure_prompt_assistant_process=real_ensure
m._prompt_assistant_process_pid_alive=old_pid_alive
m.subprocess.Popen=old_popen; m.threading.Thread=old_thread

old_ensure=m._ensure_prompt_assistant_process
internal_stops=[]; request_proc=Proc(); request_queue=queue.Queue()
m._ensure_prompt_assistant_process=lambda **kwargs:(request_proc,request_queue)
m._stop_prompt_assistant_process=lambda wait_timeout=5:internal_stops.append(wait_timeout) or "stopped"
try:
    m._request_prompt_assistant("optimizePrompt", {"prompt":"base"}, timeout=300, lock_already_held=True, deadline_monotonic=m.time.monotonic()+.02)
    raise AssertionError("absolute deadline accepted")
except TimeoutError: pass
assert internal_stops==[]
m._ensure_prompt_assistant_process=old_ensure

m._prepare_prompt_assistant_resource_handoff=lambda _:{"ok":True,"state":"runtime-memory-released","released":True}
requests=[]
def fake_request(c,p,timeout=300,**kwargs):
    unexpectedly_acquired=m.PROMPT_ASSISTANT_LOCK.acquire(blocking=False)
    if unexpectedly_acquired: m.PROMPT_ASSISTANT_LOCK.release()
    requests.append({"timeout":timeout,"kwargs":kwargs,"lockHeld":not unexpectedly_acquired,"remaining":kwargs["deadline_monotonic"]-m.time.monotonic()})
    return {"ok":True,"data":{"positivePrompt":"ok"}}
m._request_prompt_assistant=fake_request
stop={"value":"stopped","lockHeld":[]}
def fake_stop(wait_timeout=5):
    unexpectedly_acquired=m.PROMPT_ASSISTANT_LOCK.acquire(blocking=False)
    if unexpectedly_acquired: m.PROMPT_ASSISTANT_LOCK.release()
    stop["lockHeld"].append(not unexpectedly_acquired)
    return stop["value"]
m._stop_prompt_assistant_process=fake_stop
def run():
    h=object.__new__(m.PreviewRuntimeHandler); h.path=m.PROMPT_ASSISTANT_PATH+"/optimize-prompt"; h._default_base_url="http://127.0.0.1:8188"
    h._read_request_body=lambda:json.dumps({"prompt":"base","currentPrompt":"base","purpose":"optimize","surface":"art","provider":"local","supportsNegativePrompt":False}).encode()
    out=[]; h._write_json_response=lambda status,body:out.append((status,body)); h._handle_prompt_assistant(); return out[-1]
status,body=run(); assert status==200 and 270<=requests[-1]["timeout"]<=281
assert requests[-1]["kwargs"]["lock_already_held"] is True
assert 293<=requests[-1]["remaining"]<=295 and requests[-1]["lockHeld"] is True
assert stop["lockHeld"][-1] is True
stop["value"]="stop-timeout"; status,body=run(); assert status==500 and body["errorCode"]=="prompt-assistant-stop-timeout"

handoff_calls=[]; request_count=len(requests); stop_count=len(stop["lockHeld"])
m._prepare_prompt_assistant_resource_handoff=lambda value:handoff_calls.append(value) or {"ok":True}
assert m.PROMPT_ASSISTANT_LOCK.acquire(blocking=False) is True
try: status,body=run()
finally: m.PROMPT_ASSISTANT_LOCK.release()
assert status==409 and body["errorCode"]=="prompt-assistant-busy" and body["retryable"] is True
assert handoff_calls==[] and len(requests)==request_count and len(stop["lockHeld"])==stop_count

real_time=m.time
class Clock:
    value=0.0
    def monotonic(self): return self.value
clock=Clock(); m.time=clock
def budget_handoff(_): clock.value=100.0; return {"ok":True,"state":"runtime-memory-released","released":True}
def budget_request(c,p,timeout=300,**kwargs):
    assert timeout==181 and kwargs["deadline_monotonic"]==294.5
    clock.value=kwargs["deadline_monotonic"]
    return {"ok":True,"data":{"positivePrompt":"ok"}}
def budget_stop(wait_timeout=5): clock.value+=5.0; return "stopped"
m._prepare_prompt_assistant_resource_handoff=budget_handoff
m._request_prompt_assistant=budget_request
m._stop_prompt_assistant_process=budget_stop
status,body=run(); assert status==200 and clock.value==299.5 and clock.value<=300.0
m.time=real_time
print("python prompt assistant resource lifecycle: passed")
`;

const candidates = [process.env.PYTHON, "python", "py"].filter(Boolean);
let result;
for (const candidate of candidates) {
  const args = candidate === "py" ? ["-3", "-B", "-c", probe, previewPath] : ["-B", "-c", probe, previewPath];
  const attempt = spawnSync(candidate, args, { cwd: root, encoding: "utf8", timeout: 30_000 });
  if (!attempt.error || attempt.error.code !== "ENOENT") { result = attempt; break; }
}
assert.ok(result, "Python is required");
assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
assert.match(result.stdout, /resource lifecycle: passed/);
console.log("prompt-assistant-resource-lifecycle-contract: passed");
